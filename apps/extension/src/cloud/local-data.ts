import { z } from 'zod';
import {
  STORAGE_KEYS,
  applicationRecordSchema,
  profileSchema,
  type ApplicationRecord,
  type Profile,
} from '@applypilot/shared';
import {
  LocalDataChangedError,
  canonical,
  type LocalChanges,
  type LocalData,
  type LocalSnapshot,
} from '@applypilot/sync';
import { ApplicationsRepository } from '../storage/applications-repository';
import { ProfileRepository } from '../storage/profile-repository';
import type { KeyValueStore } from '../storage/storage-area';

/**
 * This browser's profile and tracker, as the sync engine sees them.
 *
 * - Writes check first that nothing changed since the engine read the data
 *   (the user may type while a sync runs); if it did, the write is refused and
 *   the engine tries again later, so no edit is lost.
 * - Stored entries this version cannot read (a corrupt profile, a record from
 *   a newer version) are never synced, changed or dropped.
 * - Before sync changes or deletes anything that already existed here, a copy
 *   is kept (the last MAX_BACKUPS), which Settings can restore.
 */

export const MAX_BACKUPS = 2;

export const syncBackupSchema = z.object({
  id: z.string(),
  createdAt: z.iso.datetime(),
  reason: z.string(),
  profile: z.unknown(),
  applications: z.array(z.unknown()),
});
export type SyncBackup = z.infer<typeof syncBackupSchema>;

export interface BackupSummary {
  id: string;
  createdAt: string;
  reason: string;
  hasProfile: boolean;
  applications: number;
}

export class ExtensionLocalData implements LocalData {
  constructor(
    private readonly store: KeyValueStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async read(): Promise<LocalSnapshot> {
    const profile = ProfileRepository.interpret(await this.store.get(STORAGE_KEYS.profile));
    const { records } = ApplicationsRepository.interpret(
      await this.store.get(STORAGE_KEYS.applications),
    );
    return {
      profile: profile.status === 'ok' ? profile.profile : null,
      profileReadable: profile.status !== 'corrupt',
      applications: records,
    };
  }

  async write(changes: LocalChanges, readAt: LocalSnapshot): Promise<void> {
    const current = await this.read();
    if (
      canonical(current.profile) !== canonical(readAt.profile) ||
      canonical(current.applications) !== canonical(readAt.applications)
    ) {
      throw new LocalDataChangedError('Local data changed while syncing.');
    }

    if (changes.profile !== undefined && current.profileReadable) {
      if (changes.profile === null) await this.store.remove(STORAGE_KEYS.profile);
      else await this.store.set(STORAGE_KEYS.profile, profileSchema.parse(changes.profile));
    }

    if (changes.upserts.length > 0 || changes.deletes.length > 0) {
      const { records, unreadable } = ApplicationsRepository.interpret(
        await this.store.get(STORAGE_KEYS.applications),
      );
      const deletes = new Set(changes.deletes);
      const upserts = new Map(
        changes.upserts.map((r) => [r.id, applicationRecordSchema.parse(r)] as const),
      );
      const next: ApplicationRecord[] = [];
      for (const record of records) {
        if (deletes.has(record.id)) continue;
        const replacement = upserts.get(record.id);
        next.push(replacement ?? record);
        upserts.delete(record.id);
      }
      // New records go first, like records added in the tracker.
      await this.store.set(STORAGE_KEYS.applications, [
        ...upserts.values(),
        ...next,
        ...unreadable,
      ]);
    }
  }

  async backup(snapshot: LocalSnapshot, reason: string): Promise<void> {
    const backups = await this.backups();
    const createdAt = this.now().toISOString();
    const entry: SyncBackup = {
      id: `${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt,
      reason,
      profile: snapshot.profile,
      applications: snapshot.applications,
    };
    await this.store.set(STORAGE_KEYS.syncBackups, [entry, ...backups].slice(0, MAX_BACKUPS));
  }

  async backups(): Promise<SyncBackup[]> {
    const parsed = z
      .array(syncBackupSchema)
      .safeParse(await this.store.get(STORAGE_KEYS.syncBackups));
    return parsed.success ? parsed.data : [];
  }

  async backupSummaries(): Promise<BackupSummary[]> {
    return (await this.backups()).map((b) => ({
      id: b.id,
      createdAt: b.createdAt,
      reason: b.reason,
      hasProfile: b.profile !== null && b.profile !== undefined,
      applications: b.applications.length,
    }));
  }

  /**
   * Puts a backup back. What is here now is backed up first, so restoring is
   * itself undoable. Unreadable stored entries are kept.
   */
  async restore(id: string): Promise<boolean> {
    const backup = (await this.backups()).find((b) => b.id === id);
    if (!backup) return false;
    const current = await this.read();
    await this.backup(current, 'Before restoring a backup');
    const profile = profileSchema.safeParse(backup.profile);
    const restoredProfile: Profile | null = profile.success ? profile.data : null;
    const records = backup.applications.flatMap((r) => {
      const parsed = applicationRecordSchema.safeParse(r);
      return parsed.success ? [parsed.data] : [];
    });
    if (current.profileReadable) {
      if (restoredProfile) await this.store.set(STORAGE_KEYS.profile, restoredProfile);
      else await this.store.remove(STORAGE_KEYS.profile);
    }
    const { unreadable } = ApplicationsRepository.interpret(
      await this.store.get(STORAGE_KEYS.applications),
    );
    await this.store.set(STORAGE_KEYS.applications, [...records, ...unreadable]);
    return true;
  }
}
