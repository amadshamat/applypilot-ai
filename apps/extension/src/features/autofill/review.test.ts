import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { proposeAnswers, scanForm } from '@applypilot/autofill';
import { emptyProfileContent } from '@applypilot/shared';
import { buildInstructions, editRow, setApproved, summarize, toRows } from './review';

function rowsFor(html: string) {
  const doc = new JSDOM(`<form>${html}</form>`, {
    url: 'https://x.example/apply',
    pretendToBeVisual: true,
  }).window.document;
  const profile = emptyProfileContent();
  profile.personal.email = 'avery@example.com';
  return toRows(proposeAnswers(scanForm(doc), { profile, resume: null, coverLetter: null }));
}

describe('autofill review rows', () => {
  it('never builds an instruction for a sensitive field, even if forced', () => {
    const rows = rowsFor(
      '<label for="e">Email</label><input id="e"><label for="g">Gender</label><select id="g"><option>Female</option><option>Male</option></select>',
    );
    const forced = rows.map((r) => ({
      ...r,
      approved: true,
      value: r.value ?? { type: 'choose' as const, value: 'Female', label: 'Female' },
    }));
    expect(buildInstructions(forced, null).map((i) => i.label)).toEqual(['Email']);
    // Editing or approving a locked row does nothing.
    const gender = rows[1]?.proposal.field.ref ?? '';
    expect(editRow(rows, gender, { type: 'choose', value: 'Female', label: 'Female' })[1]).toEqual(
      rows[1],
    );
    expect(setApproved(rows, gender, true)[1]?.approved).toBe(false);
  });

  it('selects typed values, drops cleared ones, and skips files without bytes', () => {
    const rows = rowsFor(
      '<label for="c">Company</label><input id="c"><label for="r">Resume</label><input id="r" type="file">',
    );
    const ref = rows[0]?.proposal.field.ref ?? '';
    const typed = editRow(rows, ref, { type: 'text', text: 'Acme' });
    expect(typed[0]).toMatchObject({ approved: true, edited: true });
    expect(buildInstructions(typed, null)).toHaveLength(1);
    expect(editRow(typed, ref, { type: 'text', text: '  ' })[0]).toMatchObject({
      approved: false,
      value: null,
    });
    const withFile = [
      {
        ...typed[1]!,
        approved: true,
        value: { type: 'file' as const, resumeId: 'r', fileName: 'r.pdf' },
      },
    ];
    expect(buildInstructions(withFile, null)).toEqual([]);
    expect(
      buildInstructions(withFile, { mimeType: 'application/pdf', base64: 'JVBERi0=' })[0]?.action,
    ).toMatchObject({ type: 'file', fileName: 'r.pdf' });
  });

  it('summarizes what was filled and what was not', () => {
    const rows = rowsFor('<label for="e">Email</label><input id="e">');
    const summary = summarize(
      {
        results: [{ ref: rows[0]?.proposal.field.ref ?? '', status: 'failed', message: 'No.' }],
        blockedSubmissions: 0,
        newFields: 0,
        filledAt: '2026-10-22T00:00:00.000Z',
      },
      rows,
    );
    expect(summary).toEqual({
      counts: { filled: 0, skipped: 0, failed: 1, unsupported: 0 },
      problems: [{ label: 'Email', status: 'failed', message: 'No.' }],
    });
  });
});
