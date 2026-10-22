import type { ApplicationRecord, ApplicationStage } from '@applypilot/shared';
import { CLOSED_STAGES, appliedAt, reached, SUBMITTED_STAGES } from './records';

/** Filtering, sorting and follow-up reminders over the user's records. */

export type StatusFilter = 'all' | 'active' | 'closed' | ApplicationStage;
export type SortOrder = 'updated' | 'applied' | 'company' | 'follow-up';

export interface RecordFilter {
  status: StatusFilter;
  /** Words that must all appear in the title, company, location or notes. */
  query: string;
  /** Only records whose follow-up is due on or before `today`. */
  dueOnly: boolean;
  sort: SortOrder;
}

export const DEFAULT_FILTER: RecordFilter = {
  status: 'all',
  query: '',
  dueOnly: false,
  sort: 'updated',
};

export function isClosed(record: ApplicationRecord): boolean {
  return CLOSED_STAGES.includes(record.status);
}

function haystack(record: ApplicationRecord): string {
  const { title, company, location } = record.job;
  return [title, company, location, ...record.notes.map((n) => n.text)].join(' ').toLowerCase();
}

function matchesStatus(record: ApplicationRecord, status: StatusFilter): boolean {
  if (status === 'all') return true;
  if (status === 'active') return !isClosed(record);
  if (status === 'closed') return isClosed(record);
  return record.status === status;
}

function compare(sort: SortOrder) {
  return (a: ApplicationRecord, b: ApplicationRecord): number => {
    switch (sort) {
      case 'company':
        return (
          a.job.company.localeCompare(b.job.company, undefined, { sensitivity: 'base' }) ||
          a.job.title.localeCompare(b.job.title)
        );
      case 'applied': {
        // Most recently applied first; never-applied records go last.
        const x = appliedAt(a) ?? '';
        const y = appliedAt(b) ?? '';
        return y.localeCompare(x) || b.updatedAt.localeCompare(a.updatedAt);
      }
      case 'follow-up': {
        // Soonest follow-up first; records without one go last.
        const x = a.followUp?.due ?? '9999-12-31';
        const y = b.followUp?.due ?? '9999-12-31';
        return x.localeCompare(y) || b.updatedAt.localeCompare(a.updatedAt);
      }
      default:
        return b.updatedAt.localeCompare(a.updatedAt);
    }
  };
}

export function filterRecords(
  records: readonly ApplicationRecord[],
  filter: RecordFilter,
  today: string,
): ApplicationRecord[] {
  const words = filter.query.toLowerCase().split(/\s+/).filter(Boolean);
  return records
    .filter((r) => matchesStatus(r, filter.status))
    .filter((r) => !filter.dueOnly || (r.followUp !== null && r.followUp.due <= today))
    .filter((r) => {
      if (words.length === 0) return true;
      const text = haystack(r);
      return words.every((w) => text.includes(w));
    })
    .sort(compare(filter.sort));
}

export interface Reminder {
  record: ApplicationRecord;
  due: string;
  /** Days past the due date; 0 means due today. */
  overdueDays: number;
}

export function daysBetween(fromDay: string, toDay: string): number {
  return Math.round(
    (Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86_400_000,
  );
}

/** Follow-ups due today or earlier on records that are still open, most overdue first. */
export function dueFollowUps(records: readonly ApplicationRecord[], today: string): Reminder[] {
  return records
    .filter((r) => r.followUp !== null && r.followUp.due <= today && !isClosed(r))
    .map((r) => ({
      record: r,
      due: r.followUp?.due ?? today,
      overdueDays: daysBetween(r.followUp?.due ?? today, today),
    }))
    .sort((a, b) => b.overdueDays - a.overdueDays);
}

/**
 * Applications sent at least `days` ago with no answer and no follow-up set:
 * candidates for a follow-up the user may want to schedule. Only suggested.
 */
export function quietApplications(
  records: readonly ApplicationRecord[],
  today: string,
  dayOf: (iso: string) => string,
  days = 14,
): ApplicationRecord[] {
  return records.filter((r) => {
    if (r.status !== 'applied' || r.followUp !== null) return false;
    const sent = appliedAt(r);
    return sent !== null && daysBetween(dayOf(sent), today) >= days;
  });
}

export function hasApplied(record: ApplicationRecord): boolean {
  return reached(record, SUBMITTED_STAGES);
}

/** Adds `days` to a YYYY-MM-DD day. */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The user's local calendar day for an instant. */
export function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
