import type { PartialDate } from '@applypilot/shared';

/**
 * Date handling for resume text. Resumes write dates many ways ("Jan 2024",
 * "01/2024", "2024", "Present", "Expected May 2026"); everything is reduced to
 * the profile's partial-date format ("YYYY" or "YYYY-MM").
 */

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const MONTH_NAME =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|spring|summer|fall|autumn|winter)\\.?';

/** One date: "May 2024", "05/2024", "2024-05", "2024". */
const DATE = `(?:${MONTH_NAME}\\s*,?\\s*\\d{4}|(?:0?[1-9]|1[0-2])\\s*[/.-]\\s*\\d{4}|\\d{4}\\s*-\\s*(?:0[1-9]|1[0-2])(?!\\d)|(?:19|20)\\d{2})`;
const PRESENT = '(?:present|current(?:ly)?|now|ongoing|today)';
const RANGE_SEPARATOR = '\\s*(?:-|–|—|to|until|through)\\s*';

const EXPECTED_WORD = '(?:expected|anticipated|exp\\.?)\\s*:?\\s*';
const RANGE_PATTERN = new RegExp(
  `(${DATE})${RANGE_SEPARATOR}(${EXPECTED_WORD})?(${DATE}|${PRESENT})`,
  'i',
);
const EXPECTED_PATTERN = new RegExp(
  `\\b(?:expected|anticipated|exp\\.?|graduating|class of)\\s*:?\\s*(${DATE})`,
  'i',
);
const SINGLE_PATTERN = new RegExp(`(?<![\\d/])(${DATE})(?![\\d/])`, 'i');

const SEASON_MONTHS: Record<string, number> = {
  spring: 5,
  summer: 8,
  fall: 12,
  autumn: 12,
  winter: 12,
};

/** "May 2024" → "2024-05"; returns '' when the text is not a date. */
export function toPartialDate(raw: string): PartialDate {
  const value = raw.trim().toLowerCase().replace(/\./g, '');
  const named = /^([a-z]+)\s*,?\s*(\d{4})$/.exec(value);
  if (named) {
    const word = named[1] ?? '';
    const month = MONTHS[word.slice(0, 4)] ?? MONTHS[word.slice(0, 3)] ?? SEASON_MONTHS[word];
    return month ? `${named[2] ?? ''}-${String(month).padStart(2, '0')}` : '';
  }
  const numeric = /^(\d{1,2})\s*[/-]\s*(\d{4})$/.exec(value);
  if (numeric) {
    const month = Number(numeric[1]);
    return month >= 1 && month <= 12 ? `${numeric[2] ?? ''}-${String(month).padStart(2, '0')}` : '';
  }
  const iso = /^(\d{4})\s*-\s*(\d{2})$/.exec(value);
  if (iso) return `${iso[1] ?? ''}-${iso[2] ?? ''}`;
  if (/^(19|20)\d{2}$/.test(value)) return value;
  return '';
}

export interface DateRange {
  startDate: PartialDate;
  endDate: PartialDate;
  current: boolean;
  /** The exact text that was recognised, so callers can remove it from the line. */
  matched: string;
}

/**
 * The first date range in a line. A lone date is treated as an end date (for
 * example a graduation date); "Expected May 2026" marks the entry as current.
 */
export function findDateRange(line: string): DateRange | null {
  const range = RANGE_PATTERN.exec(line);
  if (range) {
    const end = range[3] ?? '';
    const current = range[2] !== undefined || new RegExp(`^${PRESENT}$`, 'i').test(end.trim());
    const present = new RegExp(`^${PRESENT}$`, 'i').test(end.trim());
    return {
      startDate: toPartialDate(range[1] ?? ''),
      endDate: present ? '' : toPartialDate(end),
      current,
      matched: range[0],
    };
  }
  const expected = EXPECTED_PATTERN.exec(line);
  if (expected) {
    return {
      startDate: '',
      endDate: toPartialDate(expected[1] ?? ''),
      current: true,
      matched: expected[0],
    };
  }
  const single = SINGLE_PATTERN.exec(line);
  if (single) {
    return {
      startDate: '',
      endDate: toPartialDate(single[1] ?? ''),
      current: false,
      matched: single[0],
    };
  }
  return null;
}

/** True when the line contains a start–end range (a strong sign of a job or degree header). */
export function hasDateRange(line: string): boolean {
  return RANGE_PATTERN.test(line) || EXPECTED_PATTERN.test(line);
}
