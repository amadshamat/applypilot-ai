import { z } from 'zod';
import {
  applicationRecordSchema,
  profileSchema,
  type ApplicationRecord,
  type Profile,
} from '@applypilot/shared';
import {
  MAX_PUSH_CHANGES,
  PROFILE_ITEM_ID,
  cloudItemSchema,
  type ChangesResponse,
  type CloudItem,
  type ItemChange,
  type ItemKind,
  type PushResponse,
} from './contract';
import { mergeApplication, mergeProfile, same } from './merge';

/**
 * The device side of cloud sync. One run:
 *
 * 1. pulls every cloud change since the last run;
 * 2. compares each item three ways: the copy from the last sync (the
 *    "shadow"), this device's copy and the cloud's copy;
 * 3. applies cloud-only changes here, uploads device-only changes, merges
 *    items changed on both sides, and parks real clashes as conflicts for the
 *    user to decide;
 * 4. uploads with the version each change was based on, so the cloud refuses
 *    anything that would overwrite a newer copy.
 *
 * Safeguards (DECISIONS 047): local data is snapshotted before the cloud
 * changes or deletes anything here; a run that would delete more than a few
 * local records stops and asks first; a local write is refused if the user
 * edited data while the run was in progress; and if the cloud data was
 * deleted or reset since the last run, nothing is uploaded until the user
 * says what to do.
 */

const shadowSchema = z.object({
  version: z.number().int().nonnegative(),
  data: z.unknown(),
});
export type Shadow = z.infer<typeof shadowSchema>;

export const conflictSchema = z.object({
  kind: z.enum(['profile', 'application']),
  id: z.string(),
  /** This device's copy when the conflict was found; null if deleted here. */
  local: z.unknown(),
  /** The cloud's copy. */
  remote: cloudItemSchema,
  /** Fields both sides changed, or ["deleted"] when one side deleted the item. */
  fields: z.array(z.string()),
  detectedAt: z.iso.datetime(),
});
export type SyncConflict = z.infer<typeof conflictSchema>;

export const SYNC_STATE_VERSION = 1;

export const syncStateSchema = z.object({
  version: z.literal(SYNC_STATE_VERSION),
  /** The cloud data epoch this device synced with; null before the first run. */
  epoch: z.string().nullable(),
  cursor: z.number().int().nonnegative().nullable(),
  lastSyncedAt: z.iso.datetime().nullable(),
  /** Keyed by "kind:id". */
  shadows: z.record(z.string(), shadowSchema),
  conflicts: z.array(conflictSchema),
});
export type SyncState = z.infer<typeof syncStateSchema>;

export function initialSyncState(): SyncState {
  return {
    version: SYNC_STATE_VERSION,
    epoch: null,
    cursor: null,
    lastSyncedAt: null,
    shadows: {},
    conflicts: [],
  };
}

export interface LocalSnapshot {
  /** Null when there is no profile, or it cannot be read (then it is not synced). */
  profile: Profile | null;
  /** False when a stored profile exists but fails validation: it is left alone. */
  profileReadable: boolean;
  applications: ApplicationRecord[];
}

export interface LocalChanges {
  /** Undefined: leave as is. Null: delete. */
  profile?: Profile | null;
  /** Records to add or replace, by id. */
  upserts: ApplicationRecord[];
  deletes: string[];
}

export class LocalDataChangedError extends Error {
  override name = 'LocalDataChangedError';
}

/** Thrown by a transport when the cloud refuses a push because its data was deleted or reset. */
export class EpochChangedError extends Error {
  override name = 'EpochChangedError';
}

/** This device's data. Writes must fail with LocalDataChangedError if the data changed since `read`. */
export interface LocalData {
  read(): Promise<LocalSnapshot>;
  write(changes: LocalChanges, readAt: LocalSnapshot): Promise<void>;
  /** Keeps a copy of the data before the cloud changes it, so it can be restored. */
  backup(snapshot: LocalSnapshot, reason: string): Promise<void>;
}

export interface SyncTransport {
  changes(since: number | null, page: string | null): Promise<ChangesResponse>;
  push(epoch: string, changes: ItemChange[]): Promise<PushResponse>;
}

export interface SyncStateStore {
  load(): Promise<SyncState>;
  save(state: SyncState): Promise<void>;
}

export type SyncOutcome =
  | 'synced'
  /** Too many local deletions: run again with `allowDeletions` after the user agrees. */
  | 'needs-confirmation'
  /** Cloud data was deleted or reset since the last run. */
  | 'cloud-reset'
  /** Local data changed during the run; nothing was lost, run again. */
  | 'retry';

export interface SyncReport {
  outcome: SyncOutcome;
  pulled: number;
  pushed: number;
  /** Items changed on this device by the cloud (added, updated or deleted). */
  appliedHere: number;
  merged: number;
  conflicts: number;
  /** needs-confirmation: how many records here the cloud would delete. */
  pendingDeletions: number;
  /** needs-confirmation: how many cloud records this device would delete. */
  pendingCloudDeletions: number;
  rejected: { kind: ItemKind; id: string; message: string }[];
}

export interface SyncOptions {
  allowDeletions?: boolean;
  now?: () => Date;
}

/** Above this many local records deleted by one run, the user must confirm. */
export const DELETION_CONFIRM_THRESHOLD = 5;
const MAX_ROUNDS = 3;

export const keyOf = (kind: ItemKind, id: string) => `${kind}:${id}`;

function splitKey(key: string): { kind: ItemKind; id: string } {
  const at = key.indexOf(':');
  return { kind: key.slice(0, at) as ItemKind, id: key.slice(at + 1) };
}

function localMap(snapshot: LocalSnapshot): Map<string, Profile | ApplicationRecord | null> {
  const map = new Map<string, Profile | ApplicationRecord | null>();
  if (snapshot.profileReadable) map.set(keyOf('profile', PROFILE_ITEM_ID), snapshot.profile);
  for (const record of snapshot.applications) map.set(keyOf('application', record.id), record);
  return map;
}

function toChange(kind: ItemKind, id: string, baseVersion: number, data: unknown): ItemChange {
  return kind === 'profile'
    ? {
        kind,
        id: PROFILE_ITEM_ID,
        baseVersion,
        data: data === null ? null : profileSchema.parse(data),
      }
    : {
        kind,
        id,
        baseVersion,
        data: data === null ? null : applicationRecordSchema.parse(data),
      };
}

function merge(kind: ItemKind, base: unknown, local: unknown, remote: unknown) {
  return kind === 'profile'
    ? mergeProfile(
        base === null ? null : profileSchema.parse(base),
        profileSchema.parse(local),
        profileSchema.parse(remote),
      )
    : mergeApplication(
        base === null ? null : applicationRecordSchema.parse(base),
        applicationRecordSchema.parse(local),
        applicationRecordSchema.parse(remote),
      );
}

export class SyncEngine {
  constructor(
    private readonly local: LocalData,
    private readonly transport: SyncTransport,
    private readonly stateStore: SyncStateStore,
  ) {}

  async run({
    allowDeletions = false,
    now = () => new Date(),
  }: SyncOptions = {}): Promise<SyncReport> {
    const report: SyncReport = {
      outcome: 'synced',
      pulled: 0,
      pushed: 0,
      appliedHere: 0,
      merged: 0,
      conflicts: 0,
      pendingDeletions: 0,
      pendingCloudDeletions: 0,
      rejected: [],
    };
    let state = await this.stateStore.load();
    // Items the cloud answered with during a push conflict, handled in the next round.
    let extra: CloudItem[] = [];

    for (let round = 0; round < MAX_ROUNDS; round++) {
      // 1. Pull.
      const remote = new Map<string, CloudItem>();
      let page: string | null = null;
      let cursor: number | null = state.cursor;
      let epoch: string;
      do {
        const response = await this.transport.changes(state.cursor, page);
        epoch = response.epoch;
        if (state.epoch !== null && response.epoch !== state.epoch) {
          report.outcome = 'cloud-reset';
          return report;
        }
        for (const item of response.items) {
          const key = keyOf(item.kind, item.id);
          const seen = remote.get(key);
          if (!seen || seen.version < item.version) remote.set(key, item);
        }
        page = response.page;
        if (response.cursor !== null) cursor = response.cursor;
      } while (page !== null);
      for (const item of extra) {
        const key = keyOf(item.kind, item.id);
        const seen = remote.get(key);
        if (!seen || seen.version < item.version) remote.set(key, item);
      }
      extra = [];

      // 2. Compare.
      const snapshot = await this.local.read();
      const localItems = localMap(snapshot);
      const shadows = { ...state.shadows };
      const conflicts = new Map(state.conflicts.map((c) => [keyOf(c.kind, c.id), c]));
      const localChanges: LocalChanges = { upserts: [], deletes: [] };
      const pushes: ItemChange[] = [];
      let deletionsHere = 0;
      // An object, so the flag set inside applyHere is visible to the type checker.
      const touched = { existing: false };

      const applyHere = (key: string, data: unknown) => {
        const { kind, id } = splitKey(key);
        const before = localItems.get(key) ?? null;
        if (before !== null) touched.existing = true;
        if (data === null && before !== null) deletionsHere += 1;
        if (kind === 'profile') {
          localChanges.profile = data === null ? null : profileSchema.parse(data);
        } else if (data === null) {
          if (before !== null) localChanges.deletes.push(id);
        } else {
          localChanges.upserts.push(applicationRecordSchema.parse(data));
        }
        report.appliedHere += 1;
      };

      const keys = new Set([...localItems.keys(), ...Object.keys(shadows), ...remote.keys()]);
      if (!snapshot.profileReadable) keys.delete(keyOf('profile', PROFILE_ITEM_ID));
      for (const key of keys) {
        const { kind, id } = splitKey(key);
        const localData = localItems.get(key) ?? null;
        const shadow = shadows[key];
        const seenVersion = shadow?.version ?? 0;
        const candidate = remote.get(key);
        const remoteItem = candidate && candidate.version > seenVersion ? candidate : undefined;
        const localDirty = shadow ? !same(localData, shadow.data) : localData !== null;

        const open = conflicts.get(key);
        if (open) {
          // Waiting for the user. Keep the newest cloud copy next to it.
          if (remoteItem) conflicts.set(key, { ...open, remote: remoteItem });
          continue;
        }

        if (!remoteItem) {
          if (localDirty) pushes.push(toChange(kind, id, seenVersion, localData));
          continue;
        }
        report.pulled += 1;
        if (!localDirty) {
          if (!same(localData, remoteItem.data)) applyHere(key, remoteItem.data);
          shadows[key] = { version: remoteItem.version, data: remoteItem.data };
          continue;
        }
        if (same(localData, remoteItem.data)) {
          shadows[key] = { version: remoteItem.version, data: remoteItem.data };
          continue;
        }
        if (localData === null || remoteItem.data === null) {
          conflicts.set(key, {
            kind,
            id,
            local: localData,
            remote: remoteItem,
            fields: ['deleted'],
            detectedAt: now().toISOString(),
          });
          continue;
        }
        const result = merge(kind, shadow?.data ?? null, localData, remoteItem.data);
        if (result.kind === 'conflict') {
          conflicts.set(key, {
            kind,
            id,
            local: localData,
            remote: remoteItem,
            fields: result.fields,
            detectedAt: now().toISOString(),
          });
          continue;
        }
        report.merged += 1;
        if (!same(result.value, localData)) applyHere(key, result.value);
        shadows[key] = { version: remoteItem.version, data: remoteItem.data };
        if (!same(result.value, remoteItem.data)) {
          pushes.push(toChange(kind, id, remoteItem.version, result.value));
        }
      }

      // Many deletions at once, in either direction, are more often a mistake (or a
      // cleared browser) than intent: ask first.
      const deletionsThere = pushes.filter((c) => c.data === null && c.baseVersion > 0).length;
      if (
        !allowDeletions &&
        (deletionsHere > DELETION_CONFIRM_THRESHOLD || deletionsThere > DELETION_CONFIRM_THRESHOLD)
      ) {
        report.outcome = 'needs-confirmation';
        report.pendingDeletions = deletionsHere;
        report.pendingCloudDeletions = deletionsThere;
        return report;
      }

      // 3. Apply cloud changes here, after a backup.
      const hasLocalWrites =
        localChanges.profile !== undefined ||
        localChanges.upserts.length > 0 ||
        localChanges.deletes.length > 0;
      if (hasLocalWrites) {
        if (touched.existing) await this.local.backup(snapshot, 'Before cloud sync changed data');
        try {
          await this.local.write(localChanges, snapshot);
        } catch (e) {
          if (e instanceof LocalDataChangedError) {
            report.outcome = 'retry';
            return report;
          }
          throw e;
        }
      }
      state = {
        ...state,
        epoch,
        cursor,
        shadows,
        conflicts: [...conflicts.values()],
      };
      await this.stateStore.save(state);

      // 4. Upload.
      let clashed = false;
      for (let i = 0; i < pushes.length; i += MAX_PUSH_CHANGES) {
        const batch = pushes.slice(i, i + MAX_PUSH_CHANGES);
        let response: PushResponse;
        try {
          response = await this.transport.push(epoch, batch);
        } catch (e) {
          if (e instanceof EpochChangedError) {
            report.outcome = 'cloud-reset';
            return report;
          }
          throw e;
        }
        for (const result of response.results) {
          if (result.outcome === 'applied') {
            const key = keyOf(result.item.kind, result.item.id);
            shadows[key] = { version: result.item.version, data: result.item.data };
            report.pushed += 1;
          } else if (result.outcome === 'conflict') {
            clashed = true;
            if (result.current) extra.push(result.current);
          } else {
            report.rejected.push({ kind: result.kind, id: result.id, message: result.message });
          }
        }
        state = { ...state, shadows: { ...shadows } };
        await this.stateStore.save(state);
      }

      if (!clashed) break;
    }

    state = { ...state, lastSyncedAt: now().toISOString() };
    await this.stateStore.save(state);
    report.conflicts = state.conflicts.length;
    return report;
  }

  /**
   * Settles a conflict. "local" uploads this device's copy over the cloud's;
   * "cloud" replaces this device's copy (after a backup).
   */
  async resolve(kind: ItemKind, id: string, choice: 'local' | 'cloud'): Promise<void> {
    const state = await this.stateStore.load();
    const key = keyOf(kind, id);
    const conflict = state.conflicts.find((c) => keyOf(c.kind, c.id) === key);
    if (!conflict) return;
    if (choice === 'cloud') {
      const snapshot = await this.local.read();
      await this.local.backup(snapshot, 'Before using the cloud copy in a conflict');
      const data = conflict.remote.data;
      const changes: LocalChanges = { upserts: [], deletes: [] };
      if (kind === 'profile') changes.profile = data === null ? null : profileSchema.parse(data);
      else if (data === null) changes.deletes.push(id);
      else changes.upserts.push(applicationRecordSchema.parse(data));
      await this.local.write(changes, snapshot);
    }
    // Either way the cloud copy becomes the base: "local" then reads as a change to upload.
    await this.stateStore.save({
      ...state,
      shadows: {
        ...state.shadows,
        [key]: { version: conflict.remote.version, data: conflict.remote.data },
      },
      conflicts: state.conflicts.filter((c) => c !== conflict),
    });
  }
}
