import { z } from 'zod';
import { syncStatusSchema, type SyncStatus } from './sync-store';

/**
 * Messages from extension pages to the service worker, which runs every sync
 * one at a time (pages may be closed mid-sync; the worker is not).
 */

export const syncRequestSchema = z.discriminatedUnion('type', [
  /** Sync now. `allowDeletions` answers a needs-confirmation prompt. */
  z.object({ type: z.literal('sync/run'), allowDeletions: z.boolean().optional() }),
  z.object({
    type: z.literal('sync/resolve'),
    kind: z.enum(['profile', 'application']),
    id: z.string().min(1).max(64),
    choice: z.enum(['local', 'cloud']),
  }),
  /** After a cloud reset: forget the old cloud copies and upload this browser's data again. */
  z.object({ type: z.literal('sync/restart') }),
  /** Forget all sync bookkeeping (sync turned off after the cloud data was deleted). */
  z.object({ type: z.literal('sync/reset') }),
  z.object({ type: z.literal('sync/restore'), backupId: z.string().min(1).max(100) }),
]);
export type SyncRequest = z.infer<typeof syncRequestSchema>;

export const syncResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), status: syncStatusSchema }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
]);
export type SyncResponse = z.infer<typeof syncResponseSchema>;

export const isSyncRequest = (message: unknown): boolean =>
  typeof message === 'object' &&
  message !== null &&
  typeof (message as { type?: unknown }).type === 'string' &&
  (message as { type: string }).type.startsWith('sync/');

type Sender = (message: unknown) => Promise<unknown>;

/** Never throws: failures come back as `{ ok: false }`. */
export async function sendSyncRequest(
  request: SyncRequest,
  send: Sender = (m) => chrome.runtime.sendMessage(m),
): Promise<SyncResponse> {
  try {
    const parsed = syncResponseSchema.safeParse(await send(request));
    return parsed.success
      ? parsed.data
      : {
          ok: false,
          error: { code: 'INTERNAL', message: 'Unexpected answer from the extension.' },
        };
  } catch {
    return {
      ok: false,
      error: { code: 'INTERNAL', message: 'Could not reach the extension background.' },
    };
  }
}

export const okStatus = (status: SyncStatus): SyncResponse => ({ ok: true, status });
