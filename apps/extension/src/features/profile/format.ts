import type { PartialDate } from '@applypilot/shared';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2024-05" → "May 2024"; "2024" stays "2024". */
export function formatPartialDate(date: PartialDate): string {
  const match = /^(\d{4})(?:-(\d{2}))?$/.exec(date);
  if (!match) return '';
  const month = match[2] ? MONTHS[Number(match[2]) - 1] : undefined;
  return month ? `${month} ${match[1] ?? ''}` : (match[1] ?? '');
}

export function formatDateRange(
  start: PartialDate,
  end: PartialDate,
  current: boolean,
  currentLabel = 'Present',
): string {
  const from = formatPartialDate(start);
  const to = current
    ? end
      ? `${currentLabel} (until ${formatPartialDate(end)})`
      : currentLabel
    : formatPartialDate(end);
  if (from && to) return `${from} – ${to}`;
  return from || to;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Splits "a, b; c" into ["a", "b", "c"]. */
export function splitList(text: string, separator: RegExp = /[,;]/): string[] {
  return text
    .split(separator)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
