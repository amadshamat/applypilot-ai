import { z } from 'zod';
import {
  TASK_SCHEMAS,
  aiTaskSchema,
  taskResponseSchema,
  type AiTask,
  type TaskResponse,
  type TaskTypes,
} from '@applypilot/ai-core';
import { STORAGE_KEYS, jobPageIdentity } from '@applypilot/shared';
import type { KeyValueStore } from './storage-area';

/**
 * The latest AI draft of each kind for each job, kept in this browser so a
 * closed side panel does not lose (or re-bill) a draft. The request is stored
 * with the response so grounding checks can run again when the draft is shown.
 *
 * Text the user edits is stored next to the generated draft, per part (the
 * letter, the resume text, or one screening answer), so the generated text
 * stays available for "Revert to generated text". When a draft with edits is
 * generated again, the edited version is kept as `previous` until the next
 * generation, so it can be restored.
 */

/** Edited text per part of a draft; a part without an entry shows the generated text. */
export type DraftEdits = Record<string, string>;

export interface SavedDraft<T extends AiTask = AiTask> {
  task: T;
  jobKey: string;
  savedAt: string;
  request: TaskTypes[T]['request'];
  response: TaskResponse<T>;
  edits?: DraftEdits;
  editedAt?: string;
  /** The edited draft this one replaced, kept so it can be restored. */
  previous?: Omit<SavedDraft<T>, 'previous'>;
}

export const MAX_SAVED_DRAFTS = 30;
/** Parts per draft (screening answers allow 15 questions) and characters per part. */
export const MAX_EDIT_PARTS = 20;
export const MAX_EDIT_LENGTH = 20_000;

const editsSchema = z
  .record(z.string().min(1).max(40), z.string().max(MAX_EDIT_LENGTH))
  .refine((edits) => Object.keys(edits).length <= MAX_EDIT_PARTS);

const envelopeSchema = z.object({
  task: aiTaskSchema,
  jobKey: z.string().min(1).max(2100),
  savedAt: z.iso.datetime(),
  request: z.unknown(),
  response: z.unknown(),
  edits: z.unknown().optional(),
  editedAt: z.unknown().optional(),
  previous: z.unknown().optional(),
});

export const hasEdits = (draft: { edits?: DraftEdits }) =>
  draft.edits !== undefined && Object.keys(draft.edits).length > 0;

/** A stored or imported draft, checked against its task's schemas; null if it does not fit. */
export function parseSavedDraft(raw: unknown): SavedDraft | null {
  return parseDraft(raw, false);
}

function parseDraft(raw: unknown, nested: boolean): SavedDraft | null {
  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success) return null;
  const { task, jobKey, savedAt } = envelope.data;
  // Edits that do not fit are dropped; the generated draft is still usable.
  const edits = editsSchema.safeParse(envelope.data.edits).data;
  const editedAt = z.iso.datetime().safeParse(envelope.data.editedAt).data;
  const request = TASK_SCHEMAS[task].request.safeParse(envelope.data.request);
  const response = taskResponseSchema(TASK_SCHEMAS[task].output).safeParse(envelope.data.response);
  if (!request.success || !response.success || response.data.task !== task) return null;
  const draft: SavedDraft = {
    task,
    jobKey,
    savedAt,
    request: request.data,
    response: response.data,
  };
  if (edits && Object.keys(edits).length > 0) draft.edits = edits;
  if (editedAt) draft.editedAt = editedAt;
  // One level only: a replaced draft never carries its own previous version.
  if (!nested && envelope.data.previous !== undefined) {
    const previous = parseDraft(envelope.data.previous, true);
    if (previous && previous.task === task && previous.jobKey === jobKey && hasEdits(previous))
      draft.previous = previous;
  }
  return draft;
}

/** A stable key for the job on a page: its URL without the fragment, or its Indeed job id. */
export function jobKeyFor(pageUrl: string): string {
  // One key per job: on Indeed search pages that is the selected job's id, so
  // drafts for two jobs from the same search never share a key.
  return jobPageIdentity(pageUrl);
}

export class AiDraftsRepository {
  /** Writes run one after another, so edits to two parts saved together are both kept. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly store: KeyValueStore) {}

  private serial<R>(work: () => Promise<R>): Promise<R> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async list(): Promise<SavedDraft[]> {
    const raw = await this.store.get(STORAGE_KEYS.aiDrafts);
    if (!Array.isArray(raw)) return [];
    return raw.map(parseSavedDraft).filter((d): d is SavedDraft => d !== null);
  }

  async find<T extends AiTask>(task: T, jobKey: string): Promise<SavedDraft<T> | null> {
    const match = (await this.list()).find((d) => d.task === task && d.jobKey === jobKey);
    return (match as SavedDraft<T> | undefined) ?? null;
  }

  /**
   * Stores a newly generated draft. If the draft it replaces has edits, that
   * edited version is kept as `previous` (only the latest one).
   */
  save<T extends AiTask>(draft: SavedDraft<T>): Promise<SavedDraft<T>> {
    return this.serial(async () => {
      const all = await this.list();
      const existing = all.find((d) => d.task === draft.task && d.jobKey === draft.jobKey);
      const stored: SavedDraft<T> = { ...draft };
      delete stored.previous;
      if (existing) {
        const withoutPrevious: SavedDraft<T> = { ...(existing as SavedDraft<T>) };
        delete withoutPrevious.previous;
        if (hasEdits(withoutPrevious)) stored.previous = withoutPrevious;
        else if (existing.previous)
          stored.previous = existing.previous as Omit<SavedDraft<T>, 'previous'>;
      }
      const others = all.filter((d) => d !== existing);
      await this.store.set(STORAGE_KEYS.aiDrafts, [stored, ...others].slice(0, MAX_SAVED_DRAFTS));
      return stored;
    });
  }

  /**
   * Saves (or, with null, clears) the edited text of one part. Applies only
   * while the stored draft is still the one generated at `generatedAt`, so an
   * edit can never land on a newer draft. Returns the updated draft, or null
   * if that draft is gone or was replaced.
   */
  saveEdit<T extends AiTask>(
    task: T,
    jobKey: string,
    generatedAt: string,
    part: string,
    text: string | null,
    now = new Date(),
  ): Promise<SavedDraft<T> | null> {
    return this.serial(async () => {
      const all = await this.list();
      const index = all.findIndex(
        (d) => d.task === task && d.jobKey === jobKey && d.response.generatedAt === generatedAt,
      );
      const current = all[index];
      if (!current) return null;
      const edits: DraftEdits = Object.fromEntries(
        Object.entries(current.edits ?? {}).filter(([key]) => key !== part),
      );
      if (text !== null) {
        if (Object.keys(edits).length >= MAX_EDIT_PARTS) return null;
        edits[part] = text.slice(0, MAX_EDIT_LENGTH);
      }
      const updated: SavedDraft = { ...current, editedAt: now.toISOString() };
      if (Object.keys(edits).length > 0) updated.edits = edits;
      else delete updated.edits;
      all[index] = updated;
      await this.store.set(STORAGE_KEYS.aiDrafts, all);
      return updated as SavedDraft<T>;
    });
  }

  /** Swaps a draft with the edited version it replaced. Returns the restored draft. */
  restorePrevious<T extends AiTask>(task: T, jobKey: string): Promise<SavedDraft<T> | null> {
    return this.serial(async () => {
      const all = await this.list();
      const index = all.findIndex((d) => d.task === task && d.jobKey === jobKey);
      const current = all[index];
      if (!current?.previous) return null;
      const { previous, ...replaced } = current;
      const restored: SavedDraft = { ...previous };
      // The newer draft is kept as the previous version only if it was edited too.
      if (hasEdits(replaced)) restored.previous = replaced;
      all[index] = restored;
      await this.store.set(STORAGE_KEYS.aiDrafts, all);
      return restored as SavedDraft<T>;
    });
  }

  remove(task: AiTask, jobKey: string): Promise<void> {
    return this.serial(async () => {
      const kept = (await this.list()).filter((d) => !(d.task === task && d.jobKey === jobKey));
      await this.store.set(STORAGE_KEYS.aiDrafts, kept);
    });
  }
}
