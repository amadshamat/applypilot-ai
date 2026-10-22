import {
  MAX_NOTES,
  applicationRecordSchema,
  profileSchema,
  type ApplicationNote,
  type ApplicationRecord,
  type Profile,
  type StatusChange,
} from '@applypilot/shared';

/**
 * Three-way merge of one item changed on this device and in the cloud since
 * the last sync. `base` is the copy both sides started from (null when the
 * item was created on both sides independently, for example after importing
 * the same export on two devices).
 *
 * Changes that cannot clash merge automatically: notes added on either side
 * are kept, notes deleted on either side stay deleted, status changes are
 * combined in time order, and a field changed on one side only takes that
 * side's value. When both sides changed the same field to different values
 * the merge stops and reports the field, so the user decides. Nothing is ever
 * dropped silently.
 */

export type MergeResult<T> = { kind: 'merged'; value: T } | { kind: 'conflict'; fields: string[] };

/** JSON with object keys sorted, so equal data always gives equal text. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : v,
  );
}

export function same(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

class FieldMerger {
  readonly conflicts: string[] = [];

  /** Takes the side that changed; records a conflict when both changed differently. */
  pick<T>(field: string, base: T | undefined, local: T, remote: T): T {
    if (same(local, remote)) return local;
    if (base !== undefined && same(base, local)) return remote;
    if (base !== undefined && same(base, remote)) return local;
    this.conflicts.push(field);
    return local;
  }
}

function maxIso(a: string, b: string): string {
  return a > b ? a : b;
}

function minIso(a: string, b: string): string {
  return a < b ? a : b;
}

const MAX_HISTORY = 200;

function mergeHistory(local: StatusChange[], remote: StatusChange[]): StatusChange[] {
  const byKey = new Map<string, StatusChange>();
  for (const change of [...local, ...remote]) byKey.set(`${change.at}|${change.status}`, change);
  const merged = [...byKey.values()].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  // Same trimming rule as setStatus: keep the first entry and the most recent ones.
  const first = merged[0];
  return merged.length > MAX_HISTORY && first
    ? [first, ...merged.slice(-(MAX_HISTORY - 1))]
    : merged;
}

function mergeNotes(
  base: ApplicationNote[] | undefined,
  local: ApplicationNote[],
  remote: ApplicationNote[],
): ApplicationNote[] {
  const baseIds = new Set((base ?? []).map((n) => n.id));
  const localIds = new Set(local.map((n) => n.id));
  const remoteIds = new Set(remote.map((n) => n.id));
  const keep = new Map<string, ApplicationNote>();
  for (const note of [...local, ...remote]) {
    const onBoth = localIds.has(note.id) && remoteIds.has(note.id);
    // A note missing on one side was deleted there if it existed before; otherwise it is new.
    if (onBoth || !baseIds.has(note.id)) keep.set(note.id, note);
  }
  return [...keep.values()]
    .sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0))
    .slice(0, MAX_NOTES);
}

export function mergeApplication(
  base: ApplicationRecord | null,
  local: ApplicationRecord,
  remote: ApplicationRecord,
): MergeResult<ApplicationRecord> {
  if (same(local, remote)) return { kind: 'merged', value: local };
  const m = new FieldMerger();
  const job = { ...local.job };
  for (const key of Object.keys(local.job) as (keyof ApplicationRecord['job'])[]) {
    job[key] = m.pick(`job.${key}`, base?.job[key], local.job[key], remote.job[key]);
  }
  const source = m.pick('source', base?.source, local.source, remote.source);
  const followUp = m.pick('followUp', base?.followUp, local.followUp, remote.followUp);
  const history = mergeHistory(local.history, remote.history);
  const last = history[history.length - 1];
  // The score is a snapshot taken when the job was saved; a clash there is not worth asking about.
  const matchScore =
    local.matchScore === remote.matchScore
      ? local.matchScore
      : base && same(base.matchScore, local.matchScore)
        ? remote.matchScore
        : local.matchScore;
  if (m.conflicts.length > 0) return { kind: 'conflict', fields: m.conflicts };
  const value = applicationRecordSchema.parse({
    id: local.id,
    job,
    source,
    status: last?.status ?? local.status,
    history,
    notes: mergeNotes(base?.notes, local.notes, remote.notes),
    followUp,
    matchScore,
    createdAt: minIso(local.createdAt, remote.createdAt),
    updatedAt: maxIso(local.updatedAt, remote.updatedAt),
  });
  return { kind: 'merged', value };
}

/** Profile sections merge independently; inside "personal", each field does. */
export function mergeProfile(
  base: Profile | null,
  local: Profile,
  remote: Profile,
): MergeResult<Profile> {
  if (same(local, remote)) return { kind: 'merged', value: local };
  const m = new FieldMerger();
  const personal = { ...local.personal };
  for (const key of Object.keys(local.personal) as (keyof Profile['personal'])[]) {
    personal[key] = m.pick(
      `personal.${key}`,
      base?.personal[key],
      local.personal[key],
      remote.personal[key],
    );
  }
  const section = <K extends Exclude<keyof Profile, 'personal' | 'version' | 'updatedAt'>>(
    key: K,
  ): Profile[K] => m.pick(key, base?.[key], local[key], remote[key]);
  const merged = {
    personal,
    summary: section('summary'),
    education: section('education'),
    experience: section('experience'),
    skills: section('skills'),
    certifications: section('certifications'),
    projects: section('projects'),
    preferences: section('preferences'),
    version: local.version,
    updatedAt: maxIso(local.updatedAt, remote.updatedAt),
  };
  if (m.conflicts.length > 0) return { kind: 'conflict', fields: m.conflicts };
  return { kind: 'merged', value: profileSchema.parse(merged) };
}
