import { describe, expect, it } from 'vitest';
import { formScanSchema, type FillInstruction, type FormScan } from '@applypilot/shared';
import {
  REF_ATTRIBUTE,
  fillForm,
  formChanges,
  proposeAnswers,
  scanForm,
  toFillAction,
  toInstruction,
  type Proposal,
} from '../src';
import { htmlPage, loadApplication, sampleProfile } from './helpers';

const URL = 'https://careers.contoso.example/apply/7';
const FAST = { optionTimeoutMs: 400, settleMs: 20 };

interface PageWindow {
  nextCount: number;
  submitCount: number;
  formSubmits: number;
}

function propose(scan: FormScan): Proposal[] {
  return proposeAnswers(scan, { profile: sampleProfile(), resume: null, coverLetter: null });
}

function load() {
  const { dom, doc } = loadApplication('conditional-application.html', URL);
  const win = dom.window as unknown as PageWindow;
  return { doc, win };
}

function find(proposals: Proposal[], label: string): Proposal {
  const p = proposals.find((x) => x.field.label === label);
  if (!p)
    throw new Error(`no field "${label}": ${proposals.map((x) => x.field.label).join(' | ')}`);
  return p;
}

function choose(p: Proposal, label: string): FillInstruction {
  const option = p.field.options.find((o) => o.label === label);
  if (!option) throw new Error(`no option ${label}`);
  return toInstruction(p.field, { type: 'choose', value: option.value, label: option.label });
}

function proposed(p: Proposal): FillInstruction {
  const action = p.value ? toFillAction(p.value) : null;
  if (!action) throw new Error(`no value for ${p.field.label}`);
  return toInstruction(p.field, action);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Yes/No buttons and custom selection controls', () => {
  it('reads toggle buttons and role=radio buttons as questions with their answers', () => {
    const { doc } = load();
    const scan = scanForm(doc);
    expect(formScanSchema.safeParse(scan).success).toBe(true);
    const proposals = propose(scan);
    const aws = find(proposals, 'Have you used AWS in a project or job?');
    expect(aws.field).toMatchObject({
      control: 'button-group',
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
      ],
      currentValue: '',
    });
    // Not answered by the profile: the user chooses, nothing is selected for filling.
    expect(aws).toMatchObject({ status: 'unknown', value: null, approved: false });
    expect(
      find(proposals, 'Are you legally authorized to work in the United States?').field.control,
    ).toBe('button-group');
    // Hidden follow-up questions are not read until they appear.
    expect(scan.fields.some((f) => /Describe a project/.test(f.label))).toBe(false);
    // Next and Submit are never fields.
    expect(scan.fields.some((f) => /^(Next|Submit)/.test(f.label))).toBe(false);
    expect(scan.submitControls).toEqual(['Next', 'Submit application']);
  });

  it('locks work authorization, sponsorship, salary, demographic and consent questions', () => {
    const { doc } = load();
    const proposals = propose(scanForm(doc));
    for (const label of [
      'Are you legally authorized to work in the United States?',
      'Will you now or in the future require visa sponsorship?',
      'What are your salary expectations?',
      'Gender',
      'I consent to Contoso storing my information for this application.',
    ]) {
      expect(find(proposals, label), label).toMatchObject({
        status: 'manual',
        value: null,
        approved: false,
      });
    }
  });

  it('answers Yes only when the profile proves it, and still waits for review', () => {
    const { doc } = load();
    const github = find(propose(scanForm(doc)), 'Do you have a public GitHub profile?');
    expect(github).toMatchObject({
      status: 'review',
      value: { type: 'choose', value: 'yes', label: 'Yes' },
      source: 'Profile · GitHub',
      approved: false,
    });

    const profile = sampleProfile();
    profile.personal.githubUrl = '';
    const without = proposeAnswers(scanForm(doc), { profile, resume: null, coverLetter: null });
    // No GitHub link proves nothing: ApplyPilot never answers No for the user.
    expect(find(without, 'Do you have a public GitHub profile?')).toMatchObject({
      status: 'unknown',
      value: null,
    });
  });

  it('clicks the approved answer button and shows it as already filled on the next scan', async () => {
    const { doc, win } = load();
    const scan = scanForm(doc);
    const aws = find(propose(scan), 'Have you used AWS in a project or job?');
    const report = await fillForm(doc, [choose(aws, 'Yes')], FAST);
    expect(report.results).toEqual([{ ref: aws.field.ref, status: 'filled', message: '' }]);
    const yes = doc.querySelector('[data-question="aws"] button[data-value="yes"]');
    expect(yes?.getAttribute('aria-pressed')).toBe('true');
    expect(win.nextCount + win.submitCount + win.formSubmits).toBe(0);

    const again = find(propose(scanForm(doc, { keepRefs: true })), aws.field.label);
    expect(again).toMatchObject({ status: 'unknown' });
    expect(again.field.currentValue).toBe('Yes');
  });

  it('picks from an ARIA listbox revealed by an answer, mapped from the profile', async () => {
    const { doc } = load();
    const first = scanForm(doc);
    await fillForm(
      doc,
      [choose(find(propose(first), 'Have you used AWS in a project or job?'), 'Yes')],
      FAST,
    );
    const degree = find(propose(scanForm(doc, { keepRefs: true })), 'Highest level of education');
    expect(degree.field.control).toBe('listbox-button');
    // "B.S. Computer Science" in the profile is a bachelor's degree.
    expect(degree.value).toEqual({ type: 'choose', value: 'ba', label: "Bachelor's Degree" });
    const report = await fillForm(doc, [proposed(degree)], FAST);
    expect(report.results[0]?.status).toBe('filled');
    expect(doc.getElementById('degree')?.textContent.trim()).toBe("Bachelor's Degree");
  });

  it('refuses a sensitive button question even when told to fill it', async () => {
    const { doc, win } = load();
    const scan = scanForm(doc);
    const auth = find(propose(scan), 'Are you legally authorized to work in the United States?');
    // A tampered instruction that hides what the question asks.
    const instruction = { ...choose(auth, 'Yes'), label: 'Favourite colour' };
    const report = await fillForm(doc, [instruction], FAST);
    expect(report.results[0]).toMatchObject({ status: 'skipped' });
    expect(report.results[0]?.message).toMatch(/work authorization/);
    expect(doc.querySelector('.choices [aria-checked="true"]')).toBeNull();
    const sponsor = find(propose(scan), 'Will you now or in the future require visa sponsorship?');
    const second = await fillForm(doc, [choose(sponsor, 'No')], FAST);
    expect(second.results[0]?.status).toBe('skipped');
    expect(win.submitCount).toBe(0);
  });

  it('refuses salary answers in the fill step too', async () => {
    const { doc } = load();
    const salary = find(propose(scanForm(doc)), 'What are your salary expectations?');
    const report = await fillForm(
      doc,
      [toInstruction(salary.field, { type: 'text', value: '$30/hour' })],
      FAST,
    );
    expect(report.results[0]?.status).toBe('skipped');
    expect((doc.getElementById('salary') as HTMLInputElement).value).toBe('');
  });

  it('refuses a button question whose answers are demographic, whatever its label', async () => {
    const doc = htmlPage(`
      <form>
        <p id="q">Tell us about yourself</p>
        <div aria-labelledby="q">
          <button type="button" aria-pressed="false">Male</button>
          <button type="button" aria-pressed="false">Female</button>
          <button type="button" aria-pressed="false">Prefer not to say</button>
        </div>
        <label for="n">Name</label><input id="n">
      </form>`);
    const scan = scanForm(doc);
    const group = scan.fields.find((f) => f.control === 'button-group');
    expect(group).toBeDefined();
    expect(propose(scan).find((p) => p.field.ref === group?.ref)?.status).toBe('manual');
    const report = await fillForm(
      doc,
      [
        {
          ref: group?.ref ?? '',
          control: 'button-group',
          label: 'Tell us about yourself',
          action: { type: 'choose', value: 'Male', label: 'Male' },
        },
      ],
      FAST,
    );
    expect(report.results[0]?.status).toBe('skipped');
    expect(doc.querySelector('[aria-pressed="true"]')).toBeNull();
  });

  it('does not treat toolbars, tabs, unlabeled or submit buttons as questions', () => {
    const doc = htmlPage(`
      <form>
        <label for="c">Cover letter</label>
        <div role="toolbar"><button type="button" aria-pressed="false">B</button><button type="button" aria-pressed="false">I</button></div>
        <textarea id="c"></textarea>
        <div><button type="button">Yes</button><button type="button">No</button></div>
        <p>Do you agree?</p>
        <div><button>Yes</button><button>No</button></div>
        <div><button type="button">Back</button><button type="button">Next</button></div>
      </form>`);
    const scan = scanForm(doc);
    expect(scan.fields.map((f) => f.control)).toEqual(['textarea']);
    expect(scan.unsupportedFields).toEqual(['An unlabeled question with answer buttons']);
  });

  it('clicks plain answer buttons that have no pressed state, and says to check them', async () => {
    const doc = htmlPage(`
      <form>
        <p id="q">Are you open to remote work?</p>
        <div aria-labelledby="q"><button type="button">Yes</button><button type="button">No</button></div>
      </form>`);
    let clicked = '';
    doc
      .querySelectorAll('button')
      .forEach((b) => b.addEventListener('click', () => (clicked = b.textContent)));
    const scan = scanForm(doc);
    const [field] = scan.fields;
    expect(field?.control).toBe('button-group');
    const report = await fillForm(
      doc,
      [toInstruction(field!, { type: 'choose', value: 'Yes', label: 'Yes' })],
      FAST,
    );
    expect(report.results[0]).toMatchObject({ status: 'filled' });
    expect(report.results[0]?.message).toMatch(/Check that the page shows it selected/);
    expect(clicked).toBe('Yes');
  });

  it('stops when a button question changed its wording since the scan', async () => {
    const { doc } = load();
    const scan = scanForm(doc);
    const aws = find(propose(scan), 'Have you used AWS in a project or job?');
    doc.getElementById('aws-q')!.textContent = 'Do you agree to a background check?';
    const report = await fillForm(doc, [choose(aws, 'Yes')], FAST);
    // The new wording is sensitive, so it is refused before anything else.
    expect(report.results[0]?.status).toBe('skipped');
    expect(doc.querySelector('[aria-pressed="true"]')).toBeNull();

    doc.getElementById('aws-q')!.textContent = 'Have you used Azure?';
    const second = await fillForm(doc, [choose(aws, 'Yes')], FAST);
    expect(second.results[0]).toMatchObject({
      status: 'failed',
      message: 'The page changed since the scan. Scan again.',
    });
  });
});

describe('newly revealed questions', () => {
  it('counts the questions an answer revealed, without filling them', async () => {
    const { doc, win } = load();
    expect(formChanges(doc).newFields).toBeGreaterThan(0); // nothing scanned yet
    const scan = scanForm(doc);
    expect(formChanges(doc)).toEqual({ newFields: 0, removedFields: 0 });

    const proposals = propose(scan);
    const report = await fillForm(
      doc,
      [
        choose(find(proposals, 'Have you used AWS in a project or job?'), 'Yes'),
        proposed(find(proposals, 'Do you have a public GitHub profile?')),
      ],
      FAST,
    );
    expect(report.results.map((r) => r.status)).toEqual(['filled', 'filled']);
    // The project question, the education dropdown and the GitHub URL.
    expect(report.newFields).toBe(3);
    expect(formChanges(doc)).toEqual({ newFields: 3, removedFields: 0 });
    expect((doc.getElementById('aws-project') as HTMLTextAreaElement).value).toBe('');
    expect((doc.getElementById('github') as HTMLInputElement).value).toBe('');
    expect(win.nextCount + win.submitCount + win.formSubmits).toBe(0);
  });

  it('notices a question that appears later, and one that goes away', async () => {
    const { doc } = load();
    const scan = scanForm(doc);
    const office = find(propose(scan), 'Are you open to working from one of our offices?');
    const report = await fillForm(doc, [choose(office, 'Yes')], FAST);
    expect(report.newFields).toBe(0); // it loads after the fill finished
    await wait(450);
    expect(formChanges(doc).newFields).toBe(1);

    scanForm(doc, { keepRefs: true });
    await fillForm(doc, [choose(office, 'No')], FAST);
    await wait(450);
    expect(formChanges(doc)).toEqual({ newFields: 0, removedFields: 1 });
  });

  it('keeps the refs of fields already scanned and numbers new ones after them', async () => {
    const { doc } = load();
    const first = scanForm(doc);
    const proposals = propose(first);
    await fillForm(
      doc,
      [
        choose(find(proposals, 'Have you used AWS in a project or job?'), 'Yes'),
        proposed(find(proposals, 'Do you have a public GitHub profile?')),
      ],
      FAST,
    );
    const second = scanForm(doc, { keepRefs: true });
    const refOf = (scan: FormScan, label: string) =>
      scan.fields.find((f) => f.label === label)?.ref;
    for (const field of first.fields) expect(refOf(second, field.label)).toBe(field.ref);

    const highest = Math.max(...first.fields.map((f) => Number(f.ref.slice(1))));
    const added = second.fields.filter((f) => !first.fields.some((g) => g.ref === f.ref));
    expect(added.map((f) => f.label)).toEqual([
      'Describe a project where you used AWS.',
      'Highest level of education',
      'GitHub URL',
    ]);
    expect(added.every((f) => Number(f.ref.slice(1)) > highest)).toBe(true);
    // The revealed GitHub field maps to the profile's GitHub link.
    expect(find(propose(second), 'GitHub URL')).toMatchObject({
      status: 'ready',
      value: { type: 'text', text: 'https://github.com/avery' },
    });
    // A plain scan starts the numbering again.
    expect(scanForm(doc).fields.map((f) => f.ref)).toEqual(
      second.fields.map((_, i) => `f${i + 1}`),
    );
  });

  it('gives new refs to fields whose ref was copied by a cloned block', () => {
    const doc = htmlPage(`
      <form>
        <div id="job"><label for="c1">Company</label><input id="c1" name="company"></div>
        <label for="e">Email</label><input id="e" type="email">
      </form>`);
    const first = scanForm(doc);
    const company = first.fields.find((f) => f.label === 'Company');
    const email = first.fields.find((f) => f.label === 'Email');
    const clone = doc.getElementById('job')!.cloneNode(true) as HTMLElement;
    clone.querySelector('input')!.id = 'c2';
    clone.querySelector('label')!.setAttribute('for', 'c2');
    doc.getElementById('job')!.after(clone);
    expect(clone.querySelector('input')?.getAttribute(REF_ATTRIBUTE)).toBe(company?.ref);

    const second = scanForm(doc, { keepRefs: true });
    const companies = second.fields.filter((f) => f.label === 'Company');
    expect(companies).toHaveLength(2);
    // Neither copy may inherit the first field's approved answer.
    expect(companies.some((f) => f.ref === company?.ref)).toBe(false);
    expect(new Set(second.fields.map((f) => f.ref)).size).toBe(second.fields.length);
    expect(second.fields.find((f) => f.label === 'Email')?.ref).toBe(email?.ref);
  });
});
