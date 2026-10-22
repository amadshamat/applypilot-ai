import { z } from 'zod';
import { STORAGE_KEYS } from '@applypilot/shared';
import {
  initialSyncState,
  syncStateSchema,
  type SyncState,
  type SyncStateStore,
} from '@applypilot/sync';
import type { KeyValueStore } from '../storage/storage-area';

/**
 * Sync bookkeeping in chrome.storage.local. The state belongs to one cloud
 * account at one address: signing in as someone else, or pointing the
 * extension at another deployment, starts from scratch instead of comparing
 * against another account's copies.
 */

const storedStateSchema = z.object({ owner: z.string(), state: syncStateSchema });

export const ownerKey = (apiUrl: string, userId: string) => `${apiUrl}|${userId}`;

export class SyncStateRepository {
  constructor(private readonly store: KeyValueStore) {}

  async load(owner: string): Promise<SyncState> {
    const parsed = storedStateSchema.safeParse(await this.store.get(STORAGE_KEYS.syncState));
    return parsed.success && parsed.data.owner === owner ? parsed.data.state : initialSyncState();
  }

  async save(owner: string, state: SyncState): Promise<void> {
    await this.store.set(STORAGE_KEYS.syncState, { owner, state: syncStateSchema.parse(state) });
  }

  async clear(): Promise<void> {
    await this.store.remove(STORAGE_KEYS.syncState);
  }

  /** The engine's view, bound to one owner. */
  forOwner(owner: string): SyncStateStore {
    return { load: () => this.load(owner), save: (state) => this.save(owner, state) };
  }
}

export const syncConflictSummarySchema = z.object({
  kind: z.enum(['profile', 'application']),
  id: z.string(),
  /** e.g. "Cloud Intern at Acme", or "Your profile". */
  title: z.string(),
  fields: z.array(z.string()),
  detectedAt: z.string(),
});
export type SyncConflictSummary = z.infer<typeof syncConflictSummarySchema>;

export const syncStatusSchema = z.object({
  state: z.enum([
    'off',
    'syncing',
    'synced',
    /** The run would delete more than a few records; the user must confirm. */
    'needs-confirmation',
    /** The cloud data was deleted or reset elsewhere; the user decides what next. */
    'cloud-reset',
    'signed-out',
    'error',
  ]),
  message: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  lastSyncedAt: z.string().nullable(),
  pendingDeletions: z.number().int().nonnegative(),
  pendingCloudDeletions: z.number().int().nonnegative(),
  conflicts: z.array(syncConflictSummarySchema),
  /** Items the cloud refused, such as a record over the size limit. */
  rejected: z.array(z.object({ kind: z.string(), id: z.string(), message: z.string() })),
});
export type SyncStatus = z.infer<typeof syncStatusSchema>;

export const OFF_STATUS: SyncStatus = {
  state: 'off',
  message: null,
  lastRunAt: null,
  lastSyncedAt: null,
  pendingDeletions: 0,
  pendingCloudDeletions: 0,
  conflicts: [],
  rejected: [],
};

export class SyncStatusRepository {
  constructor(private readonly store: KeyValueStore) {}

  async load(): Promise<SyncStatus> {
    const parsed = syncStatusSchema.safeParse(await this.store.get(STORAGE_KEYS.syncStatus));
    return parsed.success ? parsed.data : { ...OFF_STATUS };
  }

  async save(status: SyncStatus): Promise<SyncStatus> {
    const valid = syncStatusSchema.parse(status);
    await this.store.set(STORAGE_KEYS.syncStatus, valid);
    return valid;
  }

  async clear(): Promise<void> {
    await this.store.remove(STORAGE_KEYS.syncStatus);
  }

  subscribe(listener: (status: SyncStatus) => void): () => void {
    return this.store.subscribe(STORAGE_KEYS.syncStatus, (value) => {
      const parsed = syncStatusSchema.safeParse(value);
      listener(parsed.success ? parsed.data : { ...OFF_STATUS });
    });
  }
}
