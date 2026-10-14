import { z } from 'zod';
import {
  TASK_SCHEMAS,
  aiTaskSchema,
  taskResponseSchema,
  type AiTask,
  type TaskResponse,
  type TaskTypes,
} from '@applypilot/ai-core';
import { STORAGE_KEYS } from '@applypilot/shared';
import type { KeyValueStore } from './storage-area';

/**
 * The latest AI draft of each kind for each job, kept in this browser so a
 * closed side panel does not lose (or re-bill) a draft. The request is stored
 * with the response so grounding checks can run again when the draft is shown.
 */

export interface SavedDraft<T extends AiTask = AiTask> {
  task: T;
  jobKey: string;
  savedAt: string;
  request: TaskTypes[T]['request'];
  response: TaskResponse<T>;
}

export const MAX_SAVED_DRAFTS = 30;

const envelopeSchema = z.object({
  task: aiTaskSchema,
  jobKey: z.string().min(1).max(2100),
  savedAt: z.iso.datetime(),
  request: z.unknown(),
  response: z.unknown(),
});

function parseDraft(raw: unknown): SavedDraft | null {
  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success) return null;
  const { task } = envelope.data;
  const request = TASK_SCHEMAS[task].request.safeParse(envelope.data.request);
  const response = taskResponseSchema(TASK_SCHEMAS[task].output).safeParse(envelope.data.response);
  if (!request.success || !response.success || response.data.task !== task) return null;
  return {
    ...envelope.data,
    request: request.data,
    response: response.data,
  };
}

/** A stable key for the job on a page: its URL without the fragment. */
export function jobKeyFor(pageUrl: string): string {
  const url = new URL(pageUrl);
  url.hash = '';
  return url.toString();
}

export class AiDraftsRepository {
  constructor(private readonly store: KeyValueStore) {}

  async list(): Promise<SavedDraft[]> {
    const raw = await this.store.get(STORAGE_KEYS.aiDrafts);
    if (!Array.isArray(raw)) return [];
    return raw.map(parseDraft).filter((d): d is SavedDraft => d !== null);
  }

  async find<T extends AiTask>(task: T, jobKey: string): Promise<SavedDraft<T> | null> {
    const match = (await this.list()).find((d) => d.task === task && d.jobKey === jobKey);
    return (match as SavedDraft<T> | undefined) ?? null;
  }

  async save<T extends AiTask>(draft: SavedDraft<T>): Promise<void> {
    const others = (await this.list()).filter(
      (d) => !(d.task === draft.task && d.jobKey === draft.jobKey),
    );
    await this.store.set(STORAGE_KEYS.aiDrafts, [draft, ...others].slice(0, MAX_SAVED_DRAFTS));
  }

  async remove(task: AiTask, jobKey: string): Promise<void> {
    const kept = (await this.list()).filter((d) => !(d.task === task && d.jobKey === jobKey));
    await this.store.set(STORAGE_KEYS.aiDrafts, kept);
  }
}
