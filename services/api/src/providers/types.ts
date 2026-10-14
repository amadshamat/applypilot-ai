import type { AiTask, ApiErrorCode, ProviderKind, TaskTypes, Usage } from '@applypilot/ai-core';

export interface Generated<T extends AiTask> {
  output: TaskTypes[T]['output'];
  /** The model that answered (after any server-side fallback). */
  model: string;
  usage: Usage | null;
}

export interface AiProvider {
  kind: ProviderKind;
  model: string;
  generate<T extends AiTask>(task: T, request: TaskTypes[T]['request']): Promise<Generated<T>>;
}

/** A provider failure, already translated into what the extension should show. */
export class ProviderError extends Error {
  override name = 'ProviderError';
  constructor(
    readonly code: ApiErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
