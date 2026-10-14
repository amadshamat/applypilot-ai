import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import {
  PROMPTS,
  TASK_SCHEMAS,
  estimateCostUsd,
  type AiTask,
  type PromptSpec,
  type TaskTypes,
} from '@applypilot/ai-core';
import type { Effort } from '../config';
import { ProviderError, type AiProvider, type Generated } from './types';

/**
 * Claude via the official Anthropic SDK.
 *
 * - Structured outputs: the response is constrained to the task's JSON schema
 *   and parsed with Zod by the SDK, then checked again by the extension.
 * - Adaptive thinking with an explicit effort level (configurable).
 * - Server-side fallbacks ("default"): if a safety classifier declines the
 *   request, the API retries it on Anthropic's recommended fallback model in
 *   the same call. The response records which model answered.
 */

export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export interface AnthropicProviderOptions {
  client: Anthropic;
  model: string;
  effort: Effort;
}

export function createAnthropicClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
}

function translateError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return new ProviderError(
      'PROVIDER_AUTH',
      502,
      'The Claude API rejected the API key. Check ANTHROPIC_API_KEY on the ApplyPilot API.',
    );
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new ProviderError(
      'RATE_LIMITED',
      429,
      'The Claude API is rate limiting this key. Wait a minute and try again.',
    );
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new ProviderError(
      'PROVIDER_UNAVAILABLE',
      502,
      `The Claude API rejected the request: ${error.message}`,
    );
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ProviderError(
      'PROVIDER_UNAVAILABLE',
      502,
      'Could not reach the Claude API. Check the internet connection of the computer running the ApplyPilot API.',
    );
  }
  if (error instanceof Anthropic.APIError) {
    return new ProviderError(
      'PROVIDER_UNAVAILABLE',
      502,
      `The Claude API returned an error (${String(error.status)}). Try again shortly.`,
    );
  }
  return new ProviderError(
    'INVALID_OUTPUT',
    502,
    'Claude returned a response ApplyPilot could not read.',
  );
}

export function createAnthropicProvider({
  client,
  model,
  effort,
}: AnthropicProviderOptions): AiProvider {
  async function run<Request, Output>(
    prompt: PromptSpec<Request>,
    schema: z.ZodType<Output>,
    request: Request,
  ): Promise<{ output: Output; model: string; usage: Generated<AiTask>['usage'] }> {
    let response;
    try {
      response = await client.beta.messages.parse({
        model,
        max_tokens: prompt.maxTokens,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort, format: betaZodOutputFormat(schema) },
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.buildUserMessage(request) }],
      });
    } catch (error) {
      throw translateError(error);
    }

    // A refusal means the whole fallback chain declined; there is no output to read.
    if (response.stop_reason === 'refusal') {
      throw new ProviderError(
        'REFUSED',
        422,
        'Claude declined to write this draft. Try removing unusual text from the job description.',
      );
    }
    if (response.stop_reason === 'max_tokens') {
      throw new ProviderError(
        'INVALID_OUTPUT',
        502,
        'The draft was cut off before it finished. Try again, or shorten the job description.',
      );
    }
    const output = response.parsed_output;
    if (output === null) {
      throw new ProviderError(
        'INVALID_OUTPUT',
        502,
        'Claude returned a response ApplyPilot could not read.',
      );
    }
    const inputTokens =
      response.usage.input_tokens +
      (response.usage.cache_creation_input_tokens ?? 0) +
      (response.usage.cache_read_input_tokens ?? 0);
    const outputTokens = response.usage.output_tokens;
    return {
      output,
      model: response.model,
      usage: {
        inputTokens,
        outputTokens,
        estimatedCostUsd: estimateCostUsd(response.model, inputTokens, outputTokens),
      },
    };
  }

  return {
    kind: 'anthropic',
    model,
    async generate<T extends AiTask>(
      task: T,
      request: TaskTypes[T]['request'],
    ): Promise<Generated<T>> {
      // Each task's prompt, request and output types line up through TASK_SCHEMAS;
      // TypeScript cannot follow that through the generic key, hence the casts.
      const prompt = PROMPTS[task] as unknown as PromptSpec<TaskTypes[T]['request']>;
      const schema = TASK_SCHEMAS[task].output as unknown as z.ZodType<TaskTypes[T]['output']>;
      return run(prompt, schema, request);
    },
  };
}
