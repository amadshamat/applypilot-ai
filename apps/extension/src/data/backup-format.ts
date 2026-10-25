import { z } from 'zod';
import {
  MAX_RESUME_BYTES,
  RESUME_MIME_TYPES,
  STORAGE_KEYS,
  applicationRecordSchema,
  profileSchema,
  resumeVersionMetaSchema,
  settingsSchema,
  type ApplicationRecord,
  type Profile,
  type ResumeVersionMeta,
  type Settings,
} from '@applypilot/shared';
import { SettingsRepository } from '../storage/settings-repository';
import {
  parseSavedDraft,
  MAX_SAVED_DRAFTS,
  type SavedDraft,
} from '../storage/ai-drafts-repository';
import type { ResumeStore } from '../storage/resume-store';
import type { KeyValueStore } from '../storage/storage-area';

/**
 * The backup file written by Settings > Export data, and the checks every
 * imported file goes through.
 *
 * A backup is data only. It is read with JSON.parse (never evaluated), every
 * value is checked against the same schemas the extension uses for its own
 * storage, and only fields those schemas know are kept, so nothing in a file
 * can add code, scripts or unexpected keys. Resume files are stored as bytes
 * and only ever offered for download; they are never opened or run.
 */

export const BACKUP_FORMAT = 'applypilot-backup';
export const BACKUP_FORMAT_VERSION = 2;
/** Largest file accepted for import (resume files make backups large). */
export const MAX_BACKUP_BYTES = 60 * 1024 * 1024;

/** Keys never exported: credentials and the import undo copy (which is a backup itself). */
const NOT_EXPORTED = new Set<string>([STORAGE_KEYS.importUndo, STORAGE_KEYS.dataReset]);

// ---------- base64 for resume files ----------

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) return null;
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** PDF files start with "%PDF-"; Word (.docx) files are ZIP archives starting with "PK". */
function looksLike(mimeType: ResumeVersionMeta['mimeType'], bytes: Uint8Array): boolean {
  const head = String.fromCharCode(...bytes.subarray(0, 5));
  return mimeType === RESUME_MIME_TYPES.pdf ? head === '%PDF-' : head.startsWith('PK');
}

// ---------- export ----------

export interface BackupResume {
  meta: ResumeVersionMeta;
  bytes: Uint8Array<ArrayBuffer>;
}

export async function buildBackup(
  localStore: KeyValueStore,
  resumes: ResumeStore,
  options: { appVersion: string; now?: Date; includeResumeFiles?: boolean },
): Promise<string> {
  const all = await localStore.getAll();
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(all)) {
    if (!NOT_EXPORTED.has(key)) data[key] = value;
  }
  // The API access token is a credential; it is not part of an export.
  const connection = data[STORAGE_KEYS.aiConnection];
  if (typeof connection === 'object' && connection !== null && 'token' in connection) {
    data[STORAGE_KEYS.aiConnection] = { ...connection, token: '(not exported)' };
  }
  const metas = await resumes.list();
  const resumeEntries = [];
  for (const meta of metas) {
    let file: { base64: string } | undefined;
    if (options.includeResumeFiles !== false) {
      const blob = await resumes.getFile(meta.id);
      if (blob) file = { base64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) };
    }
    resumeEntries.push({ ...meta, ...(file ? { file } : {}) });
  }
  return JSON.stringify(
    {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      appVersion: options.appVersion,
      exportedAt: (options.now ?? new Date()).toISOString(),
      data,
      resumes: resumeEntries,
    },
    null,
    2,
  );
}

// ---------- parsing an imported file ----------

export interface ParsedBackup {
  /** 1: exports from versions 0.1 to 0.6 (no resume files). 2: from 0.7. */
  formatVersion: 1 | 2;
  appVersion: string | null;
  exportedAt: string | null;
  profile: { status: 'none' } | { status: 'ok'; profile: Profile } | { status: 'invalid' };
  /** null when the backup holds no tracker at all (then Replace leaves the tracker alone). */
  applications: { records: ApplicationRecord[]; invalid: number; duplicateIds: number } | null;
  settings: { status: 'none' } | { status: 'ok'; settings: Settings; defaulted: boolean };
  aiDrafts: { drafts: SavedDraft[]; invalid: number } | null;
  resumes: { files: BackupResume[]; withoutFile: number; invalid: number };
  /** Device-specific or unknown items in the file that are never imported. */
  ignored: string[];
}

export type ParseResult = { ok: true; backup: ParsedBackup } | { ok: false; error: string };

const v2HeaderSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  formatVersion: z.number().int().positive(),
  appVersion: z.string().max(40).optional(),
  exportedAt: z.string().max(40).optional(),
});

const resumeEntrySchema = resumeVersionMetaSchema.extend({
  file: z.object({ base64: z.string() }).optional(),
});

/** Items that belong to one browser and are never imported. */
const DEVICE_KEYS: Record<string, string> = {
  [STORAGE_KEYS.aiConnection]: 'AI connection (enter the access token again in Settings)',
  [STORAGE_KEYS.cloud]: 'Cloud sync settings',
  [STORAGE_KEYS.syncState]: 'Cloud sync bookkeeping',
  [STORAGE_KEYS.syncStatus]: 'Cloud sync status',
  [STORAGE_KEYS.syncBackups]: 'Cloud sync backups',
};

const IMPORTED_KEYS = new Set<string>([
  STORAGE_KEYS.profile,
  STORAGE_KEYS.applications,
  STORAGE_KEYS.settings,
  STORAGE_KEYS.aiDrafts,
]);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const own = (record: Record<string, unknown>, key: string): unknown =>
  Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;

export function parseBackup(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {
      ok: false,
      error:
        'This file is not valid JSON, so it is not an ApplyPilot backup. It may be damaged or cut short.',
    };
  }
  if (!isRecord(raw)) return { ok: false, error: 'This file is not an ApplyPilot backup.' };

  let formatVersion: 1 | 2;
  let appVersion: string | null = null;
  let exportedAt: string | null;
  if (own(raw, 'format') !== undefined) {
    const header = v2HeaderSchema.safeParse(raw);
    if (!header.success) return { ok: false, error: 'This file is not an ApplyPilot backup.' };
    if (header.data.formatVersion > BACKUP_FORMAT_VERSION) {
      return {
        ok: false,
        error: `This backup was made by a newer version of ApplyPilot (${header.data.appVersion ?? 'unknown'}). Update the extension, then import it again.`,
      };
    }
    formatVersion = 2;
    appVersion = header.data.appVersion ?? null;
    exportedAt = header.data.exportedAt ?? null;
  } else {
    // Exports from 0.1 to 0.6 have no format marker: { exportedAt, data, resumes }.
    formatVersion = 1;
    const at = own(raw, 'exportedAt');
    exportedAt = typeof at === 'string' ? at.slice(0, 40) : null;
  }
  const data = own(raw, 'data');
  if (!isRecord(data))
    return { ok: false, error: 'This file is not an ApplyPilot backup: it has no saved data.' };

  // Profile.
  const rawProfile = own(data, STORAGE_KEYS.profile);
  let profile: ParsedBackup['profile'] = { status: 'none' };
  if (rawProfile !== undefined && rawProfile !== null) {
    const parsed = profileSchema.safeParse(rawProfile);
    profile = parsed.success ? { status: 'ok', profile: parsed.data } : { status: 'invalid' };
  }

  // Tracked applications: each record checked on its own; duplicate ids keep the first.
  const rawApps = own(data, STORAGE_KEYS.applications);
  let applications: ParsedBackup['applications'] = null;
  if (Array.isArray(rawApps)) {
    const seen = new Set<string>();
    const records: ApplicationRecord[] = [];
    let invalid = 0;
    let duplicateIds = 0;
    for (const item of rawApps) {
      const parsed = applicationRecordSchema.safeParse(item);
      if (!parsed.success) invalid += 1;
      else if (seen.has(parsed.data.id)) duplicateIds += 1;
      else {
        seen.add(parsed.data.id);
        records.push(parsed.data);
      }
    }
    applications = { records, invalid, duplicateIds };
  }

  // Settings: valid fields kept, others back to defaults.
  const rawSettings = own(data, STORAGE_KEYS.settings);
  let settings: ParsedBackup['settings'] = { status: 'none' };
  if (isRecord(rawSettings)) {
    settings = {
      status: 'ok',
      settings: SettingsRepository.coerce(rawSettings),
      defaulted: !settingsSchema.safeParse(rawSettings).success,
    };
  }

  // Saved AI drafts.
  const rawDrafts = own(data, STORAGE_KEYS.aiDrafts);
  let aiDrafts: ParsedBackup['aiDrafts'] = null;
  if (Array.isArray(rawDrafts)) {
    const drafts = rawDrafts.map(parseSavedDraft);
    aiDrafts = {
      drafts: drafts.filter((d): d is SavedDraft => d !== null).slice(0, MAX_SAVED_DRAFTS),
      invalid: drafts.filter((d) => d === null).length,
    };
  }

  // Resumes: metadata always; the original file only in format 2.
  const rawResumes = own(raw, 'resumes');
  const resumes: ParsedBackup['resumes'] = { files: [], withoutFile: 0, invalid: 0 };
  const seenResumes = new Set<string>();
  if (Array.isArray(rawResumes)) {
    for (const item of rawResumes) {
      const parsed = resumeEntrySchema.safeParse(item);
      if (!parsed.success || seenResumes.has(parsed.data.id)) {
        resumes.invalid += 1;
        continue;
      }
      seenResumes.add(parsed.data.id);
      const { file, ...meta } = parsed.data;
      if (!file) {
        resumes.withoutFile += 1;
        continue;
      }
      const bytes =
        file.base64.length <= Math.ceil((MAX_RESUME_BYTES * 4) / 3) + 4
          ? base64ToBytes(file.base64)
          : null;
      if (!bytes || bytes.length !== meta.size || !looksLike(meta.mimeType, bytes)) {
        resumes.invalid += 1;
        continue;
      }
      resumes.files.push({ meta, bytes });
    }
  }

  const ignored = Object.keys(data)
    .filter((key) => !IMPORTED_KEYS.has(key))
    .map((key) => DEVICE_KEYS[key] ?? `Unknown item "${key.slice(0, 60)}"`);

  const backup: ParsedBackup = {
    formatVersion,
    appVersion,
    exportedAt,
    profile,
    applications,
    settings,
    aiDrafts,
    resumes,
    ignored,
  };
  const nothing =
    profile.status === 'none' &&
    applications === null &&
    settings.status === 'none' &&
    aiDrafts === null &&
    resumes.files.length === 0 &&
    resumes.withoutFile === 0 &&
    resumes.invalid === 0;
  if (nothing) return { ok: false, error: 'This backup holds nothing ApplyPilot can restore.' };
  return { ok: true, backup };
}
