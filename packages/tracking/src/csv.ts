import type { ApplicationRecord } from '@applypilot/shared';
import { STAGE_LABELS, appliedAt } from './records';

/**
 * CSV export of the user's records (RFC 4180, CRLF line endings, UTF-8 with a
 * byte order mark so spreadsheet apps read accents correctly).
 *
 * Job titles, companies and notes can come from web pages, so every cell that
 * a spreadsheet would treat as a formula (starting with =, +, -, @, tab or
 * carriage return) is prefixed with an apostrophe: opening the export can
 * never run a formula planted in a job posting.
 */

const BOM = '\uFEFF';
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | null): string {
  if (value === null) return '';
  let text = String(value);
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const CSV_COLUMNS = [
  'Title',
  'Company',
  'Location',
  'Status',
  'Applied on',
  'Saved on',
  'Last updated',
  'Follow-up due',
  'Follow-up note',
  'Match score',
  'Pay',
  'Platform',
  'Added from',
  'URL',
  'Status history',
  'Notes',
] as const;

export function toCsv(
  records: readonly ApplicationRecord[],
  dayOf: (iso: string) => string,
): string {
  const rows = records.map((r) => {
    const sent = appliedAt(r);
    return [
      r.job.title,
      r.job.company,
      r.job.location,
      STAGE_LABELS[r.status],
      sent ? dayOf(sent) : '',
      dayOf(r.createdAt),
      dayOf(r.updatedAt),
      r.followUp?.due ?? '',
      r.followUp?.note ?? '',
      r.matchScore,
      r.job.pay,
      r.job.platform,
      r.source,
      r.job.url,
      r.history.map((h) => `${dayOf(h.at)} ${STAGE_LABELS[h.status]}`).join('; '),
      [...r.notes]
        .reverse()
        .map((n) => `${dayOf(n.at)}: ${n.text}`)
        .join('\n'),
    ];
  });
  const lines = [[...CSV_COLUMNS], ...rows].map((cells) => cells.map(csvCell).join(','));
  return `${BOM}${lines.join('\r\n')}\r\n`;
}
