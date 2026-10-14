import type { Experience, PartialDate } from '@applypilot/shared';

/**
 * Years of experience from the profile's dated roles. Overlapping roles are
 * counted once. A year without a month is read conservatively (start in
 * December, end in January) so the total is never inflated.
 */

function toMonthIndex(date: PartialDate, edge: 'start' | 'end'): number | null {
  const match = /^(\d{4})(?:-(\d{2}))?$/.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) : edge === 'start' ? 12 : 1;
  return year * 12 + (month - 1);
}

export interface ExperienceSummary {
  years: number;
  /** Roles without a usable start date, which could not be counted. */
  undatedRoles: number;
}

export function totalExperience(roles: readonly Experience[], now: Date): ExperienceSummary {
  const nowIndex = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const ranges: Array<[number, number]> = [];
  let undatedRoles = 0;
  for (const role of roles) {
    const start = toMonthIndex(role.startDate, 'start');
    const end = role.current ? nowIndex : toMonthIndex(role.endDate, 'end');
    if (start === null || end === null || end < start) {
      undatedRoles += 1;
      continue;
    }
    // Inclusive of both months: May–Aug is four months.
    ranges.push([start, Math.min(end, nowIndex) + 1]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  let months = 0;
  let cursor = -Infinity;
  for (const [start, end] of ranges) {
    const from = Math.max(start, cursor);
    if (end > from) months += end - from;
    cursor = Math.max(cursor, end);
  }
  return { years: Math.round((months / 12) * 10) / 10, undatedRoles };
}
