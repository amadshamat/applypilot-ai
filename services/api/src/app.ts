import { timingSafeEqual } from 'node:crypto';
import type { z } from 'zod';
import {
  AI_TASKS,
  PROMPTS,
  TASK_SCHEMAS,
  classifyQuestion,
  explainClassification,
  hasUsableJob,
  type AiTask,
  type ApiErrorBody,
  type ApiErrorCode,
  type HealthResponse,
  type ScreeningRequest,
  type TaskResponse,
  type TaskTypes,
} from '@applypilot/ai-core';
import type { ApiConfig } from './config';
import { DailyLimiter } from './limiter';
import { ProviderError, type AiProvider } from './providers/types';

/**
 * The API as a pure request → response function, independent of the HTTP
 * server. The local Node server wraps it today; an AWS Lambda handler can wrap
 * the same function in Phase 6.
 */

export interface ApiRequest {
  method: string;
  path: string;
  /** Lower-case header names. */
  headers: Record<string, string | undefined>;
  body: string;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

export interface LogEntry {
  route: string;
  status: number;
  durationMs: number;
  task?: AiTask;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number | null;
}

export interface ApiDependencies {
  config: ApiConfig;
  provider: AiProvider;
  limiter?: DailyLimiter;
  now?: () => Date;
  /** Receives metadata only. Request and response content are never logged. */
  log?: (entry: LogEntry) => void;
}

function error(status: number, code: ApiErrorCode, message: string): ApiResponse {
  const body: ApiErrorBody = { error: { code, message } };
  return { status, body };
}

function tokenMatches(header: string | undefined, token: string): boolean {
  const match = /^Bearer (.+)$/.exec(header ?? '');
  if (!match?.[1]) return false;
  const given = Buffer.from(match[1]);
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function describeIssue(issue: z.core.$ZodIssue | undefined): string {
  if (!issue) return 'The request is not valid.';
  const path = issue.path.length > 0 ? issue.path.join('.') : 'request';
  return `Invalid ${path}: ${issue.message}`;
}

/** Splits screening questions into those a model may draft and those the user must answer. */
function filterScreening(request: ScreeningRequest) {
  const draftable: ScreeningRequest['questions'] = [];
  const skipped: TaskResponse<'screening-answers'>['skipped'] = [];
  for (const question of request.questions) {
    const classification = classifyQuestion(question.text);
    if (classification.category === 'draftable') draftable.push(question);
    else skipped.push({ questionId: question.id, reason: explainClassification(classification) });
  }
  return { draftable, skipped };
}

export function createApi({
  config,
  provider,
  limiter = new DailyLimiter(config.dailyLimit),
  now = () => new Date(),
  log = () => undefined,
}: ApiDependencies) {
  // T ties the task to its request and output types inside the body.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  async function generate<T extends AiTask>(task: T, raw: unknown): Promise<ApiResponse> {
    const schema = TASK_SCHEMAS[task].request as unknown as z.ZodType<TaskTypes[T]['request']>;
    const parsed = schema.safeParse(raw);
    if (!parsed.success)
      return error(400, 'INVALID_REQUEST', describeIssue(parsed.error.issues[0]));
    let request = parsed.data;

    if (!hasUsableJob((request as { job: TaskTypes[T]['request']['job'] }).job)) {
      return error(
        400,
        'INVALID_REQUEST',
        'The job has no description or qualifications to work from. Analyze the posting again.',
      );
    }

    let skipped: TaskResponse<T>['skipped'] = [];
    if (task === 'screening-answers') {
      const screening = filterScreening(request as ScreeningRequest);
      skipped = screening.skipped;
      if (screening.draftable.length === 0) {
        // Nothing a model may draft: answer without calling (or charging for) the provider.
        return {
          status: 200,
          body: {
            task,
            promptVersion: PROMPTS[task].version,
            provider: provider.kind,
            model: provider.model,
            output: { answers: [] },
            usage: null,
            skipped,
            generatedAt: now().toISOString(),
          } satisfies TaskResponse<'screening-answers'>,
        };
      }
      request = {
        ...(request as ScreeningRequest),
        questions: screening.draftable,
      };
    }

    if (!limiter.tryConsume(now())) {
      return error(
        429,
        'DAILY_LIMIT',
        `The daily limit of ${config.dailyLimit} AI requests has been reached. It resets at midnight, or raise APPLYPILOT_DAILY_LIMIT.`,
      );
    }

    const generated = await provider.generate(task, request);
    const output = TASK_SCHEMAS[task].output.safeParse(generated.output);
    if (!output.success) {
      return error(502, 'INVALID_OUTPUT', 'The AI response did not match the expected format.');
    }
    const body: TaskResponse<T> = {
      task,
      promptVersion: PROMPTS[task].version,
      provider: provider.kind,
      model: generated.model,
      output: output.data,
      usage: generated.usage,
      skipped,
      generatedAt: now().toISOString(),
    };
    return { status: 200, body };
  }

  async function route(request: ApiRequest): Promise<ApiResponse> {
    if (!tokenMatches(request.headers.authorization, config.token)) {
      return error(401, 'UNAUTHORIZED', 'Missing or wrong access token.');
    }

    if (request.path === '/v1/health') {
      if (request.method !== 'GET') return error(405, 'METHOD_NOT_ALLOWED', 'Use GET.');
      const body: HealthResponse = {
        ok: true,
        service: 'applypilot-api',
        version: config.version,
        provider: provider.kind,
        model: provider.model,
        requestsToday: limiter.used(now()),
        dailyLimit: config.dailyLimit,
      };
      return { status: 200, body };
    }

    const task = AI_TASKS.find((t) => request.path === `/v1/${t}`);
    if (!task) return error(404, 'NOT_FOUND', 'Unknown endpoint.');
    if (request.method !== 'POST') return error(405, 'METHOD_NOT_ALLOWED', 'Use POST.');
    if (!/^application\/json\b/i.test(request.headers['content-type'] ?? '')) {
      return error(400, 'INVALID_REQUEST', 'Send JSON with Content-Type: application/json.');
    }
    let raw: unknown;
    try {
      raw = JSON.parse(request.body);
    } catch {
      return error(400, 'INVALID_REQUEST', 'The request body is not valid JSON.');
    }
    return generate(task, raw);
  }

  return async function handle(request: ApiRequest): Promise<ApiResponse> {
    const started = Date.now();
    let response: ApiResponse;
    try {
      response = await route(request);
    } catch (e) {
      response =
        e instanceof ProviderError
          ? error(e.status, e.code, e.message)
          : error(500, 'INTERNAL', 'Something went wrong in the ApplyPilot API.');
      if (!(e instanceof ProviderError)) console.error(e instanceof Error ? e.stack : String(e));
    }
    const body = response.body as Partial<TaskResponse<AiTask>>;
    log({
      route: `${request.method} ${request.path}`,
      status: response.status,
      durationMs: Date.now() - started,
      ...(body.task ? { task: body.task } : {}),
      ...(body.model ? { model: body.model } : {}),
      ...(body.usage
        ? {
            inputTokens: body.usage.inputTokens,
            outputTokens: body.usage.outputTokens,
            estimatedCostUsd: body.usage.estimatedCostUsd,
          }
        : {}),
    });
    return response;
  };
}
