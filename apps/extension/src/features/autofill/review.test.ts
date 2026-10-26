import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { proposeAnswers, scanForm } from '@applypilot/autofill';
import { emptyProfileContent } from '@applypilot/shared';
import {
  buildInstructions,
  editRow,
  fillableRows,
  mergeRows,
  rowKey,
  setApproved,
  summarize,
  toRows,
  type ReviewRow,
} from './review';

function pageFor(html: string) {
  const doc = new JSDOM(`<form>${html}</form>`, {
    url: 'https://x.example/apply',
    pretendToBeVisual: true,
  }).window.document;
  const profile = emptyProfileContent();
  profile.personal.email = 'avery@example.com';
  profile.personal.phone = '555 0100';
  const rows = (keepRefs = false) =>
    toRows(
      proposeAnswers(scanForm(doc, { keepRefs }), { profile, resume: null, coverLetter: null }),
    );
  return { doc, rows };
}

function rowsFor(html: string) {
  return pageFor(html).rows();
}

const byLabel = (rows: readonly ReviewRow[], label: string) => {
  const row = rows.find((r) => r.proposal.field.label === label);
  if (!row) throw new Error(`no row ${label}`);
  return row;
};

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

  describe('re-scan', () => {
    const FORM =
      '<label for="e">Email</label><input id="e"><label for="p">Phone</label><input id="p"><label for="c">Company</label><input id="c"><div id="more"></div>';

    function rescan(html = '') {
      const page = pageFor(FORM);
      let rows = page.rows();
      // The user unticks Phone and types a company.
      rows = setApproved(rows, byLabel(rows, 'Phone').proposal.field.ref, false);
      rows = editRow(rows, byLabel(rows, 'Company').proposal.field.ref, {
        type: 'text',
        text: 'Acme',
      });
      page.doc.getElementById('more')!.innerHTML = html;
      const known = new Set(rows.map(rowKey));
      return { before: rows, after: mergeRows(rows, page.rows(true), known), page };
    }

    it('keeps edits and ticks, and leaves new fields unticked and marked new', () => {
      const { after } = rescan(
        '<label for="g">GitHub</label><input id="g"><label for="s">Desired salary</label><input id="s">',
      );
      expect(byLabel(after, 'Email')).toMatchObject({ approved: true, isNew: false });
      expect(byLabel(after, 'Phone')).toMatchObject({ approved: false, isNew: false });
      expect(byLabel(after, 'Company')).toMatchObject({
        approved: true,
        edited: true,
        value: { type: 'text', text: 'Acme' },
      });
      // Not in this profile, so missing; new, and never ticked on its own.
      expect(byLabel(after, 'GitHub')).toMatchObject({ isNew: true, approved: false });
      expect(byLabel(after, 'Desired salary')).toMatchObject({
        isNew: true,
        approved: false,
        value: null,
      });
      expect(buildInstructions(after, null).map((i) => i.label)).toEqual(['Email', 'Company']);
    });

    it('does not tick a new field even when the profile has an exact value for it', () => {
      const { after } = rescan('<label for="m">Email address</label><input id="m">');
      const added = byLabel(after, 'Email address');
      expect(added.proposal.status).toBe('ready');
      expect(added.proposal.approved).toBe(true); // a fresh scan would tick it
      expect(added).toMatchObject({ isNew: true, approved: false });
      expect(buildInstructions(after, null).map((i) => i.label)).not.toContain('Email address');
      // The user ticks it: now it is filled.
      const ticked = setApproved(after, added.proposal.field.ref, true);
      expect(buildInstructions(ticked, null).map((i) => i.label)).toContain('Email address');
    });

    it('treats a reworded question as new', () => {
      const page = pageFor('<label for="q">Company</label><input id="q">');
      let rows = page.rows();
      rows = editRow(rows, rows[0]!.proposal.field.ref, { type: 'text', text: 'Acme' });
      page.doc.querySelector('label')!.textContent = 'Desired salary';
      const after = mergeRows(rows, page.rows(true), new Set(rows.map(rowKey)));
      expect(after[0]).toMatchObject({ isNew: true, edited: false, approved: false, value: null });
      expect(after[0]?.proposal.status).toBe('manual');
    });

    it('keeps the New mark when proposals are recomputed, and drops it on a fresh scan', () => {
      const { after, page } = rescan('<label for="g">GitHub</label><input id="g">');
      const recomputed = mergeRows(after, page.rows(true), new Set(after.map(rowKey)));
      expect(byLabel(recomputed, 'GitHub').isNew).toBe(true);
      expect(mergeRows([], page.rows(), null).some((r) => r.isNew)).toBe(false);
    });

    it('does not send a value the page already shows', () => {
      const { after, page } = rescan();
      (page.doc.getElementById('e') as HTMLInputElement).value = 'avery@example.com';
      (page.doc.getElementById('c') as HTMLInputElement).value = 'Acme';
      const shown = mergeRows(after, page.rows(true), new Set(after.map(rowKey)));
      expect(byLabel(shown, 'Email').proposal.status).toBe('done');
      expect(fillableRows(shown)).toEqual([]);
      expect(buildInstructions(shown, null)).toEqual([]);
    });
  });
});
