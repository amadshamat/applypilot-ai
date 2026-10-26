import {
  pageShows,
  toFillAction,
  toInstruction,
  type Proposal,
  type ProposalStatus,
  type ProposedValue,
} from '@applypilot/autofill';
import type { FillInstruction, FillReport, FillStatus } from '@applypilot/shared';

/**
 * The review list behind the Autofill tab: one row per detected field, with
 * the value the user will fill (proposed, edited or typed) and whether they
 * approved it. Pure functions, so the rules are unit tested apart from React.
 */

export interface ReviewRow {
  proposal: Proposal;
  /** The value to fill: the proposal's, or what the user edited or typed. */
  value: ProposedValue | null;
  approved: boolean;
  /** Set when the user changed the value; shown as the source. */
  edited: boolean;
  /** Appeared on a re-scan (a question the answers revealed): never selected until the user ticks it. */
  isNew: boolean;
}

/** Statuses the user may never fill from ApplyPilot, whatever they type. */
const LOCKED: ReadonlySet<ProposalStatus> = new Set(['manual', 'unsupported']);

export function isLocked(row: ReviewRow): boolean {
  return LOCKED.has(row.proposal.status) || row.proposal.classification.kind.startsWith('manual.');
}

export function toRows(proposals: readonly Proposal[]): ReviewRow[] {
  return proposals.map((proposal) => ({
    proposal,
    value: proposal.value,
    approved: proposal.approved && proposal.value !== null,
    edited: false,
    isNew: false,
  }));
}

/**
 * Which field a row is about, across re-scans: the same ref (the re-scan
 * keeps refs of fields still on the page), the same kind of control and the
 * same question. If the page reworded a question, it is a new question.
 */
export function rowKey(row: ReviewRow): string {
  const { field } = row.proposal;
  return `${field.ref}|${field.control}|${normalizeLabel(field.label)}`;
}

function normalizeLabel(label: string): string {
  return label.toLowerCase().replace(/\s+/g, ' ').trim();
}

function sameValue(a: ProposedValue | null, b: ProposedValue | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Merges a re-scan into the review list. A field the user already reviewed
 * keeps what they decided: their edited value, and their tick (or untick) as
 * long as the proposed value did not change. Everything else comes from the
 * fresh proposal, which also notices values the page now shows. Fields the
 * re-scan found for the first time are marked new and start unticked, so
 * nothing new is filled before the user looks at it. Locked rows stay locked.
 *
 * `known` holds the keys from before the re-scan; null means a fresh scan.
 */
export function mergeRows(
  current: readonly ReviewRow[],
  fresh: readonly ReviewRow[],
  known: ReadonlySet<string> | null,
): ReviewRow[] {
  const byKey = new Map(current.map((row) => [rowKey(row), row]));
  return fresh.map((row) => {
    const key = rowKey(row);
    const before = byKey.get(key);
    if (isLocked(row)) return { ...row, approved: false, edited: false, isNew: isNewKey(key) };
    if (before?.edited) {
      return {
        ...row,
        value: before.value,
        edited: true,
        approved: before.approved,
        isNew: before.isNew,
      };
    }
    if (before) {
      return {
        ...row,
        approved: sameValue(before.value, row.value)
          ? before.approved && row.value !== null
          : row.approved,
        isNew: before.isNew,
      };
    }
    const added = isNewKey(key);
    return { ...row, approved: added ? false : row.approved, isNew: added };
  });

  function isNewKey(key: string): boolean {
    if (!known) return byKey.get(key)?.isNew ?? false;
    return !known.has(key) || (byKey.get(key)?.isNew ?? false);
  }
}

/** Rows the next Fill will send: approved, not locked, and not already shown on the page. */
export function fillableRows(rows: readonly ReviewRow[]): ReviewRow[] {
  return rows.filter((row) => {
    if (!row.approved || !row.value || isLocked(row)) return false;
    if (row.proposal.status === 'done' && !row.edited) return false;
    return !pageShows(row.proposal.field, row.value);
  });
}

/** Replaces a row's value with the user's edit and selects it for filling. */
export function editRow(
  rows: readonly ReviewRow[],
  ref: string,
  value: ProposedValue | null,
): ReviewRow[] {
  return rows.map((row) => {
    if (row.proposal.field.ref !== ref || isLocked(row)) return row;
    const empty = value === null || (value.type === 'text' && value.text.trim() === '');
    return { ...row, value: empty ? null : value, edited: true, approved: !empty };
  });
}

export function setApproved(
  rows: readonly ReviewRow[],
  ref: string,
  approved: boolean,
): ReviewRow[] {
  return rows.map((row) =>
    row.proposal.field.ref === ref && !isLocked(row) && row.value !== null
      ? { ...row, approved }
      : row,
  );
}

/** Applies drafted answers (AI Tailor) to question rows, as review-only values. */
export function applyDrafts(
  rows: readonly ReviewRow[],
  drafts: Readonly<Record<string, string>>,
): ReviewRow[] {
  return rows.map((row) => {
    const text = drafts[row.proposal.field.ref]?.trim();
    if (!text || isLocked(row) || row.edited) return row;
    return {
      ...row,
      value: { type: 'text', text },
      approved: false,
      edited: false,
      proposal: {
        ...row.proposal,
        source: 'AI Tailor draft',
        status: 'review',
        note: 'Drafted by AI from your profile. Edit it before you fill it.',
      },
    };
  });
}

export type RowGroup = 'ready' | 'review' | 'questions' | 'missing' | 'manual' | 'other';

export function groupOf(row: ReviewRow): RowGroup {
  switch (row.proposal.status) {
    case 'ready':
    case 'done':
      return 'ready';
    case 'review':
      return 'review';
    case 'question':
      return 'questions';
    case 'missing':
      return 'missing';
    case 'manual':
      return 'manual';
    default:
      return 'other';
  }
}

export interface FileContent {
  mimeType: string;
  base64: string;
}

/**
 * What the content script will fill: approved rows with a value, never a
 * locked row, never a field the page already shows. A resume file
 * is included only when its bytes were loaded.
 */
export function buildInstructions(
  rows: readonly ReviewRow[],
  resumeFile: FileContent | null,
): FillInstruction[] {
  const out: FillInstruction[] = [];
  for (const row of fillableRows(rows)) {
    if (!row.value) continue;
    const action = toFillAction(
      row.value,
      row.value.type === 'file' ? (resumeFile ?? undefined) : undefined,
    );
    if (action) out.push(toInstruction(row.proposal.field, action));
  }
  return out;
}

/** Plain text of a value, for previews and the copy fallback. */
export function valueText(value: ProposedValue | null): string {
  if (!value) return '';
  switch (value.type) {
    case 'text':
      return value.text;
    case 'choose':
      return value.label;
    case 'choose-many':
      return value.labels.join(', ');
    case 'check':
      return value.checked ? 'Checked' : 'Unchecked';
    case 'file':
      return value.fileName;
  }
}

export interface FillSummary {
  counts: Record<FillStatus, number>;
  /** Rows the user approved that did not get filled, with the reason. */
  problems: { label: string; status: FillStatus; message: string }[];
}

export function summarize(report: FillReport, rows: readonly ReviewRow[]): FillSummary {
  const counts: Record<FillStatus, number> = { filled: 0, skipped: 0, failed: 0, unsupported: 0 };
  const problems: FillSummary['problems'] = [];
  for (const result of report.results) {
    counts[result.status] += 1;
    if (result.status !== 'filled') {
      const label =
        rows.find((r) => r.proposal.field.ref === result.ref)?.proposal.field.label ?? result.ref;
      problems.push({
        label: label || 'Unlabeled field',
        status: result.status,
        message: result.message,
      });
    }
  }
  return { counts, problems };
}

/** Base64 of a file's bytes, for the content script (messages carry JSON only). */
export async function fileToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
