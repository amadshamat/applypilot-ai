import { z } from 'zod';
import {
  MAX_APPLICATIONS,
  STORAGE_KEYS,
  resumeVersionMetaSchema,
  type ApplicationRecord,
  type Profile,
  type ResumeVersionMeta,
  type Settings,
} from '@applypilot/shared';
import { canonical } from '@applypilot/sync';
import { findDuplicate } from '@applypilot/tracking';
import {
  MAX_SAVED_DRAFTS,
  type SavedDraft,
  AiDraftsRepository,
} from '../storage/ai-drafts-repository';
import { ApplicationsRepository, type ApplicationsLoad } from '../storage/applications-repository';
import { ProfileRepository, type ProfileLoad } from '../storage/profile-repository';
import type { ResumeStore } from '../storage/resume-store';
import { SettingsRepository } from '../storage/settings-repository';
import type { KeyValueStore } from '../storage/storage-area';
import {
  base64ToBytes,
  bytesToBase64,
  type BackupResume,
  type ParsedBackup,
} from './backup-format';

/**
 * Turning a checked backup into changes, previewing them, applying them and
 * undoing them.
 *
 * - **Merge** never changes or removes anything already here. It adds what is
 *   missing: records with new ids that are not the same job as one already
 *   tracked, drafts for jobs without one, resumes not already uploaded, and
 *   the profile only when there is none. Settings stay as they are.
 * - **Replace** makes each part the backup contains match the backup: the
 *   profile, the tracker, settings, AI drafts, and resumes (only when the
 *   backup holds resume files). Parts the backup does not contain are left
 *   alone.
 *
 * Before either is applied, everything it could touch is copied into
 * `applypilot.importUndo`, so the last import can be undone, and if writing
 * fails part-way the copy is put back. Entries this version cannot read are
 * kept in both modes.
 */

export type ImportMode = 'merge' | 'replace';

export interface CurrentData {
  profile: ProfileLoad;
  applications: ApplicationsLoad;
  settings: Settings;
  aiDrafts: SavedDraft[];
  resumes: ResumeVersionMeta[];
}

export async function readCurrent(
  store: KeyValueStore,
  resumes: ResumeStore,
): Promise<CurrentData> {
  return {
    profile: ProfileRepository.interpret(await store.get(STORAGE_KEYS.profile)),
    applications: ApplicationsRepository.interpret(await store.get(STORAGE_KEYS.applications)),
    settings: SettingsRepository.coerce(await store.get(STORAGE_KEYS.settings)),
    aiDrafts: await new AiDraftsRepository(store).list(),
    resumes: await resumes.list(),
  };
}

export interface ImportPlan {
  mode: ImportMode;
  /** add: none here; replace: overwrite; keep: this browser's stays; same: identical; none: not in backup. */
  profile: { action: 'add' | 'replace' | 'keep' | 'same' | 'none'; value: Profile | null };
  applications: {
    /** The tracker after import, or null to leave it untouched. */
    final: ApplicationRecord[] | null;
    added: number;
    /** Same record (same id and content) already here. */
    already: number;
    /** Same id here with different content: this browser's copy kept (merge) or replaced (replace). */
    differing: number;
    /** A different record for the same job is already tracked (merge only): skipped. */
    sameJob: number;
    overLimit: number;
    /** Records here that are not in the backup and would be removed (replace only). */
    removed: number;
  };
  settings: { action: 'restore' | 'keep' | 'same' | 'none'; value: Settings | null };
  aiDrafts: {
    final: SavedDraft[] | null;
    added: number;
    already: number;
    removed: number;
    overLimit: number;
  };
  resumes: { add: BackupResume[]; remove: string[]; already: number };
}

const draftKey = (d: SavedDraft) => `${d.task}|${d.jobKey}`;
const resumeKey = (m: ResumeVersionMeta) => `${m.fileName}|${m.size}|${m.uploadedAt}`;

export function planImport(
  backup: ParsedBackup,
  current: CurrentData,
  mode: ImportMode,
): ImportPlan {
  const replace = mode === 'replace';

  // Profile.
  let profile: ImportPlan['profile'] = { action: 'none', value: null };
  if (backup.profile.status === 'ok') {
    const incoming = backup.profile.profile;
    const here = current.profile;
    if (here.status === 'ok' && canonical(here.profile) === canonical(incoming)) {
      profile = { action: 'same', value: null };
    } else if (here.status === 'empty') {
      profile = { action: 'add', value: incoming };
    } else {
      profile = replace ? { action: 'replace', value: incoming } : { action: 'keep', value: null };
    }
  }

  // Applications.
  const apps: ImportPlan['applications'] = {
    final: null,
    added: 0,
    already: 0,
    differing: 0,
    sameJob: 0,
    overLimit: 0,
    removed: 0,
  };
  if (backup.applications) {
    const here = new Map(current.applications.records.map((r) => [r.id, r]));
    const room = MAX_APPLICATIONS - current.applications.unreadable.length;
    if (replace) {
      const final: ApplicationRecord[] = [];
      for (const record of backup.applications.records) {
        if (final.length >= room) {
          apps.overLimit += 1;
          continue;
        }
        const existing = here.get(record.id);
        if (!existing) apps.added += 1;
        else if (canonical(existing) === canonical(record)) apps.already += 1;
        else apps.differing += 1;
        final.push(record);
      }
      const kept = new Set(final.map((r) => r.id));
      apps.removed = current.applications.records.filter((r) => !kept.has(r.id)).length;
      const unchanged = apps.added === 0 && apps.differing === 0 && apps.removed === 0;
      apps.final = unchanged ? null : final;
    } else {
      const added: ApplicationRecord[] = [];
      for (const record of backup.applications.records) {
        const existing = here.get(record.id);
        if (existing) {
          if (canonical(existing) === canonical(record)) apps.already += 1;
          else apps.differing += 1;
          continue;
        }
        if (findDuplicate([...current.applications.records, ...added], record.job)) {
          apps.sameJob += 1;
          continue;
        }
        if (current.applications.records.length + added.length >= room) {
          apps.overLimit += 1;
          continue;
        }
        added.push(record);
      }
      apps.added = added.length;
      apps.final = added.length > 0 ? [...added, ...current.applications.records] : null;
    }
  }

  // Settings.
  let settings: ImportPlan['settings'] = { action: 'none', value: null };
  if (backup.settings.status === 'ok') {
    const incoming = backup.settings.settings;
    if (canonical(incoming) === canonical(current.settings))
      settings = { action: 'same', value: null };
    else
      settings = replace ? { action: 'restore', value: incoming } : { action: 'keep', value: null };
  }

  // AI drafts.
  const drafts: ImportPlan['aiDrafts'] = {
    final: null,
    added: 0,
    already: 0,
    removed: 0,
    overLimit: 0,
  };
  if (backup.aiDrafts) {
    const here = new Map(current.aiDrafts.map((d) => [draftKey(d), d]));
    if (replace) {
      const final = backup.aiDrafts.drafts;
      for (const d of final) {
        if (here.has(draftKey(d))) drafts.already += 1;
        else drafts.added += 1;
      }
      const kept = new Set(final.map(draftKey));
      drafts.removed = current.aiDrafts.filter((d) => !kept.has(draftKey(d))).length;
      const unchanged =
        drafts.added === 0 &&
        drafts.removed === 0 &&
        canonical(final) === canonical(current.aiDrafts);
      drafts.final = unchanged ? null : final;
    } else {
      const added: SavedDraft[] = [];
      for (const d of backup.aiDrafts.drafts) {
        if (here.has(draftKey(d))) drafts.already += 1;
        else if (current.aiDrafts.length + added.length >= MAX_SAVED_DRAFTS) drafts.overLimit += 1;
        else added.push(d);
      }
      drafts.added = added.length;
      drafts.final = added.length > 0 ? [...current.aiDrafts, ...added] : null;
    }
  }

  // Resumes.
  const resumes: ImportPlan['resumes'] = { add: [], remove: [], already: 0 };
  const hereIds = new Set(current.resumes.map((m) => m.id));
  const hereKeys = new Set(current.resumes.map(resumeKey));
  for (const file of backup.resumes.files) {
    if (hereIds.has(file.meta.id) || hereKeys.has(resumeKey(file.meta))) resumes.already += 1;
    else resumes.add.push(file);
  }
  if (replace && backup.resumes.files.length > 0) {
    const incomingIds = new Set(backup.resumes.files.map((f) => f.meta.id));
    const incomingKeys = new Set(backup.resumes.files.map((f) => resumeKey(f.meta)));
    resumes.remove = current.resumes
      .filter((m) => !incomingIds.has(m.id) && !incomingKeys.has(resumeKey(m)))
      .map((m) => m.id);
  }

  return { mode, profile, applications: apps, settings, aiDrafts: drafts, resumes };
}

/** True when applying the plan would change nothing. */
export function planIsEmpty(plan: ImportPlan): boolean {
  return (
    plan.profile.action !== 'add' &&
    plan.profile.action !== 'replace' &&
    plan.applications.final === null &&
    plan.settings.action !== 'restore' &&
    plan.aiDrafts.final === null &&
    plan.resumes.add.length === 0 &&
    plan.resumes.remove.length === 0
  );
}

// ---------- undo copy ----------

const UNDO_KEYS = [
  STORAGE_KEYS.profile,
  STORAGE_KEYS.applications,
  STORAGE_KEYS.settings,
  STORAGE_KEYS.aiDrafts,
] as const;

const undoSchema = z.object({
  createdAt: z.string(),
  mode: z.enum(['merge', 'replace']),
  local: z.record(z.string(), z.unknown()),
  resumes: z.array(z.object({ meta: resumeVersionMetaSchema, base64: z.string() })),
});
export type ImportUndo = z.infer<typeof undoSchema>;

async function snapshot(store: KeyValueStore, resumes: ResumeStore, mode: ImportMode, now: Date) {
  const local: Record<string, unknown> = {};
  for (const key of UNDO_KEYS) {
    const value = await store.get(key);
    if (value !== undefined) local[key] = value;
  }
  const files = [];
  for (const meta of await resumes.list()) {
    const blob = await resumes.getFile(meta.id);
    if (blob) files.push({ meta, base64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) });
  }
  const undo: ImportUndo = { createdAt: now.toISOString(), mode, local, resumes: files };
  return undo;
}

async function restoreSnapshot(store: KeyValueStore, resumes: ResumeStore, undo: ImportUndo) {
  for (const key of UNDO_KEYS) {
    if (Object.prototype.hasOwnProperty.call(undo.local, key))
      await store.set(key, undo.local[key]);
    else await store.remove(key);
  }
  await resumes.clear();
  for (const { meta, base64 } of undo.resumes) {
    const bytes = base64ToBytes(base64);
    if (bytes) await resumes.put(meta, new Blob([bytes], { type: meta.mimeType }));
  }
}

export async function loadUndo(store: KeyValueStore): Promise<ImportUndo | null> {
  const parsed = undoSchema.safeParse(await store.get(STORAGE_KEYS.importUndo));
  return parsed.success ? parsed.data : null;
}

/** Tells every open ApplyPilot page that stored data was deleted or replaced. */
export async function announceDataReset(
  store: KeyValueStore,
  reason: 'deleted' | 'imported' | 'undone',
  origin: string,
  now = new Date(),
) {
  await store.set(STORAGE_KEYS.dataReset, { at: now.toISOString(), reason, origin });
}

export class ImportFailedError extends Error {
  override name = 'ImportFailedError';
}

export interface ApplyDeps {
  store: KeyValueStore;
  resumes: ResumeStore;
  /** Identifies the page doing the import (see DataResetBoundary). */
  origin: string;
  now?: () => Date;
}

/** Applies a plan. If any write fails, everything is put back as it was and ImportFailedError is thrown. */
export async function applyImport(plan: ImportPlan, deps: ApplyDeps): Promise<void> {
  const { store, resumes } = deps;
  const now = deps.now?.() ?? new Date();
  const undo = await snapshot(store, resumes, plan.mode, now);
  await store.set(STORAGE_KEYS.importUndo, undo);
  try {
    if (
      plan.profile.value &&
      (plan.profile.action === 'add' || plan.profile.action === 'replace')
    ) {
      await store.set(STORAGE_KEYS.profile, plan.profile.value);
    }
    if (plan.applications.final) {
      // Re-read so entries this version cannot read are kept as they are.
      const { unreadable } = ApplicationsRepository.interpret(
        await store.get(STORAGE_KEYS.applications),
      );
      await store.set(STORAGE_KEYS.applications, [...plan.applications.final, ...unreadable]);
    }
    if (plan.settings.action === 'restore' && plan.settings.value) {
      await store.set(STORAGE_KEYS.settings, plan.settings.value);
    }
    if (plan.aiDrafts.final)
      await store.set(STORAGE_KEYS.aiDrafts, plan.aiDrafts.final.slice(0, MAX_SAVED_DRAFTS));
    for (const id of plan.resumes.remove) await resumes.remove(id);
    for (const { meta, bytes } of plan.resumes.add) {
      await resumes.put(meta, new Blob([bytes], { type: meta.mimeType }));
    }
  } catch (error) {
    try {
      await restoreSnapshot(store, resumes, undo);
    } catch {
      // The undo copy is still stored; Undo last import can try again.
    }
    throw new ImportFailedError(
      `The import could not be finished (${error instanceof Error ? error.message : 'storage error'}). Your data was put back as it was.`,
    );
  }
  await announceDataReset(store, 'imported', deps.origin, now);
}

/** Puts back what was here before the last import. Returns false if there is nothing to undo. */
export async function undoLastImport(deps: ApplyDeps): Promise<boolean> {
  const undo = await loadUndo(deps.store);
  if (!undo) return false;
  await restoreSnapshot(deps.store, deps.resumes, undo);
  await deps.store.remove(STORAGE_KEYS.importUndo);
  await announceDataReset(deps.store, 'undone', deps.origin, deps.now?.() ?? new Date());
  return true;
}
