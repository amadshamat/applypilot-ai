import {
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
  }));
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
 * locked row, never a field the page already shows unchanged. A resume file
 * is included only when its bytes were loaded.
 */
export function buildInstructions(
  rows: readonly ReviewRow[],
  resumeFile: FileContent | null,
): FillInstruction[] {
  const out: FillInstruction[] = [];
  for (const row of rows) {
    if (!row.approved || !row.value || isLocked(row)) continue;
    if (row.proposal.status === 'done' && !row.edited) continue;
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
