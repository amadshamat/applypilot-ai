import {
  APPLICATION_STAGES,
  type ApplicationRecord,
  type ApplicationStage,
} from '@applypilot/shared';
import { appliedAt, firstResponseAt, reached } from './records';
import { addDays, daysBetween, isClosed } from './views';

/**
 * Analytics computed only from the user's own records. Every number can be
 * traced back to the records it counts; rates are null when there is nothing
 * to divide by, rather than a misleading 0%.
 */

export interface WeekCount {
  /** Monday of the week (YYYY-MM-DD). */
  weekStart: string;
  applied: number;
}

export interface Analytics {
  total: number;
  active: number;
  byStatus: Record<ApplicationStage, number>;
  /** Records that were sent (reached Applied or a later stage). */
  applied: number;
  /** Applied records that got any answer: assessment, interview, offer or rejection. */
  responded: number;
  interviews: number;
  offers: number;
  responseRate: number | null;
  interviewRate: number | null;
  offerRate: number | null;
  /** Median days from applying to the first answer, over answered applications. */
  medianDaysToResponse: number | null;
  /** Mean match score of applied records that have one. */
  averageMatchScore: number | null;
  /** Applications sent per week, oldest week first, ending with the current week. */
  weekly: WeekCount[];
  /** Records by where the job came from (platform), most first. */
  byPlatform: { platform: string; count: number }[];
}

function rate(part: number, whole: number): number | null {
  return whole === 0 ? null : part / whole;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 1 ? sorted[mid] : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  return value ?? null;
}

function mondayOf(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, -((weekday + 6) % 7));
}

export function computeAnalytics(
  records: readonly ApplicationRecord[],
  options: { today: string; dayOf: (iso: string) => string; weeks?: number },
): Analytics {
  const { today, dayOf } = options;
  const weeks = options.weeks ?? 8;
  const byStatus = Object.fromEntries(APPLICATION_STAGES.map((s) => [s, 0])) as Record<
    ApplicationStage,
    number
  >;
  for (const r of records) byStatus[r.status] += 1;

  const sent = records.filter((r) => appliedAt(r) !== null);
  const responded = sent.filter((r) => firstResponseAt(r) !== null);
  const interviews = sent.filter((r) => reached(r, ['interview', 'offer'])).length;
  const offers = sent.filter((r) => reached(r, ['offer'])).length;
  const waits = responded.map((r) =>
    daysBetween(dayOf(appliedAt(r) ?? ''), dayOf(firstResponseAt(r) ?? '')),
  );
  const scores = sent.map((r) => r.matchScore).filter((s): s is number => s !== null);

  const thisWeek = mondayOf(today);
  const weekly: WeekCount[] = Array.from({ length: weeks }, (_, i) => ({
    weekStart: addDays(thisWeek, -7 * (weeks - 1 - i)),
    applied: 0,
  }));
  for (const r of sent) {
    const week = mondayOf(dayOf(appliedAt(r) ?? ''));
    const bucket = weekly.find((w) => w.weekStart === week);
    if (bucket) bucket.applied += 1;
  }

  const platforms = new Map<string, number>();
  for (const r of records) {
    const key = r.job.platform || 'other';
    platforms.set(key, (platforms.get(key) ?? 0) + 1);
  }

  return {
    total: records.length,
    active: records.filter((r) => !isClosed(r)).length,
    byStatus,
    applied: sent.length,
    responded: responded.length,
    interviews,
    offers,
    responseRate: rate(responded.length, sent.length),
    interviewRate: rate(interviews, sent.length),
    offerRate: rate(offers, sent.length),
    medianDaysToResponse: median(waits),
    averageMatchScore:
      scores.length === 0
        ? null
        : Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length),
    weekly,
    byPlatform: [...platforms]
      .map(([platform, count]) => ({ platform, count }))
      .sort((a, b) => b.count - a.count || a.platform.localeCompare(b.platform)),
  };
}
