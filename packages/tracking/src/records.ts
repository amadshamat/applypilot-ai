import {
  MAX_NOTES,
  applicationRecordSchema,
  newApplicationSchema,
  type ApplicationJob,
  type ApplicationRecord,
  type ApplicationStage,
  type FollowUp,
  type NewApplication,
} from '@applypilot/shared';

/**
 * Pure operations on application records. Each returns a new, validated
 * record and never changes its input, so the side panel can update state and
 * storage from the same value.
 */

export interface Clock {
  now: () => Date;
  newId: () => string;
}

export const STAGE_LABELS: Record<ApplicationStage, string> = {
  saved: 'Saved',
  preparing: 'Preparing',
  'ready-to-apply': 'Ready to apply',
  applied: 'Applied',
  assessment: 'Assessment',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

/** Stages that mean the application was sent. Withdrawn is not one: it can happen before applying. */
export const SUBMITTED_STAGES: readonly ApplicationStage[] = [
  'applied',
  'assessment',
  'interview',
  'offer',
  'rejected',
];
/** Stages that mean the employer answered. */
export const RESPONSE_STAGES: readonly ApplicationStage[] = [
  'assessment',
  'interview',
  'offer',
  'rejected',
];
export const CLOSED_STAGES: readonly ApplicationStage[] = ['rejected', 'withdrawn'];

const MAX_HISTORY = 200;

export function createApplication(input: NewApplication, clock: Clock): ApplicationRecord {
  const data = newApplicationSchema.parse(input);
  const at = clock.now().toISOString();
  return applicationRecordSchema.parse({
    id: clock.newId(),
    job: data.job,
    source: data.source,
    status: data.status,
    history: [{ status: data.status, at }],
    notes: [],
    followUp: null,
    matchScore: data.matchScore,
    createdAt: at,
    updatedAt: at,
  });
}

function touch(record: ApplicationRecord, changes: Partial<ApplicationRecord>, now: Date) {
  return applicationRecordSchema.parse({ ...record, ...changes, updatedAt: now.toISOString() });
}

export function setStatus(
  record: ApplicationRecord,
  status: ApplicationStage,
  now: Date,
): ApplicationRecord {
  if (record.status === status) return record;
  const all = [...record.history, { status, at: now.toISOString() }];
  // Keep the first entry (when tracking began) and the most recent changes.
  const history =
    all.length > MAX_HISTORY ? [...all.slice(0, 1), ...all.slice(-(MAX_HISTORY - 1))] : all;
  return touch(record, { status, history }, now);
}

export function addNote(record: ApplicationRecord, text: string, clock: Clock): ApplicationRecord {
  const trimmed = text.trim();
  if (!trimmed) return record;
  const now = clock.now();
  const note = { id: clock.newId(), text: trimmed.slice(0, 2000), at: now.toISOString() };
  // Newest first; the oldest notes fall off past the limit.
  return touch(record, { notes: [note, ...record.notes].slice(0, MAX_NOTES) }, now);
}

export function removeNote(record: ApplicationRecord, noteId: string, now: Date) {
  if (!record.notes.some((n) => n.id === noteId)) return record;
  return touch(record, { notes: record.notes.filter((n) => n.id !== noteId) }, now);
}

export function setFollowUp(record: ApplicationRecord, followUp: FollowUp | null, now: Date) {
  return touch(record, { followUp }, now);
}

export function updateJob(record: ApplicationRecord, job: Partial<ApplicationJob>, now: Date) {
  return touch(record, { job: { ...record.job, ...job } }, now);
}

/** When the application was sent: the first time it reached a submitted stage. */
export function appliedAt(record: ApplicationRecord): string | null {
  return record.history.find((h) => SUBMITTED_STAGES.includes(h.status))?.at ?? null;
}

/** When the employer first answered after the application was sent. */
export function firstResponseAt(record: ApplicationRecord): string | null {
  const sent = appliedAt(record);
  if (!sent) return null;
  return record.history.find((h) => h.at >= sent && RESPONSE_STAGES.includes(h.status))?.at ?? null;
}

export function reached(record: ApplicationRecord, stages: readonly ApplicationStage[]): boolean {
  return record.history.some((h) => stages.includes(h.status));
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}`.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * A record that already tracks this job: the same posting identity or address,
 * or the same company and title. Returns the most recently updated match.
 */
export function findDuplicate(
  records: readonly ApplicationRecord[],
  job: Pick<ApplicationJob, 'jobKey' | 'url' | 'title' | 'company'>,
): ApplicationRecord | null {
  const key = job.jobKey.trim();
  const url = normalizeUrl(job.url);
  const name =
    job.company.trim() && job.title.trim()
      ? `${normalize(job.company)}|${normalize(job.title)}`
      : '';
  const matches = records.filter(
    (r) =>
      (key && r.job.jobKey === key) ||
      (url && normalizeUrl(r.job.url) === url) ||
      (name && `${normalize(r.job.company)}|${normalize(r.job.title)}` === name),
  );
  return matches.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
}
