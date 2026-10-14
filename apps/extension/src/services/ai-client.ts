import {
  TASK_SCHEMAS,
  apiErrorSchema,
  healthResponseSchema,
  taskResponseSchema,
  type AiTask,
  type ApiErrorCode,
  type HealthResponse,
  type TaskResponse,
  type TaskTypes,
} from '@applypilot/ai-core';
import type { AiConnection } from '../storage/ai-connection-repository';

/**
 * Talks to the ApplyPilot API. Every response is validated before use; a
 * response that does not match the contract is treated as an error, never
 * shown.
 */

export type AiClientErrorCode = ApiErrorCode | 'NETWORK' | 'TIMEOUT' | 'BAD_RESPONSE';

export class AiClientError extends Error {
  override name = 'AiClientError';
  constructor(
    readonly code: AiClientErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface AiClient {
  health(connection: AiConnection): Promise<HealthResponse>;
  run<T extends AiTask>(
    connection: AiConnection,
    task: T,
    request: TaskTypes[T]['request'],
  ): Promise<TaskResponse<T>>;
}

export const AI_TIMEOUT_MS = 180_000;

export function createAiClient(
  fetchImpl: typeof fetch = (...args) => fetch(...args),
  timeoutMs = AI_TIMEOUT_MS,
): AiClient {
  async function call(connection: AiConnection, path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${connection.token}`);
      response = await fetchImpl(`${connection.apiUrl}${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(timeoutMs),
        credentials: 'omit',
        cache: 'no-store',
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'TimeoutError') {
        throw new AiClientError('TIMEOUT', 'The ApplyPilot API took too long to answer.');
      }
      throw new AiClientError(
        'NETWORK',
        `Could not reach the ApplyPilot API at ${connection.apiUrl}. Is it running? Start it with "pnpm api".`,
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new AiClientError(
        'BAD_RESPONSE',
        'The ApplyPilot API sent a response that is not JSON.',
      );
    }
    if (!response.ok) {
      const parsed = apiErrorSchema.safeParse(body);
      if (parsed.success)
        throw new AiClientError(parsed.data.error.code, parsed.data.error.message);
      throw new AiClientError(
        'BAD_RESPONSE',
        `The ApplyPilot API answered with status ${response.status}.`,
      );
    }
    return body;
  }

  return {
    async health(connection) {
      const parsed = healthResponseSchema.safeParse(
        await call(connection, '/v1/health', { method: 'GET' }),
      );
      if (!parsed.success) {
        throw new AiClientError(
          'BAD_RESPONSE',
          'That address does not look like the ApplyPilot API.',
        );
      }
      return parsed.data;
    },
    async run(connection, task, request) {
      const body = await call(connection, `/v1/${task}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const parsed = taskResponseSchema(TASK_SCHEMAS[task].output).safeParse(body);
      if (!parsed.success || parsed.data.task !== task) {
        throw new AiClientError('BAD_RESPONSE', 'The AI response was not in the expected format.');
      }
      return parsed.data as TaskResponse<typeof task>;
    },
  };
}
