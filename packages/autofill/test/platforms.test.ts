import { describe, expect, it } from 'vitest';
import type { FillInstruction } from '@applypilot/shared';
import {
  PLATFORMS,
  detectFormPlatform,
  fillForm,
  proposeAnswers,
  scanForm,
  toFillAction,
  toInstruction,
} from '../src';
import { loadApplication, sampleProfile } from './helpers';

const RESUME = { id: 'r1', fileName: 'Avery_Chen_Resume.pdf', text: 'Avery Chen' };
const FAST = { optionTimeoutMs: 600, settleMs: 20 };

function load(file: string, url: string) {
  const { dom, doc } = loadApplication(file, url);
  const scan = scanForm(doc);
  const proposals = proposeAnswers(scan, {
    profile: sampleProfile(),
    resume: RESUME,
    coverLetter: null,
  });
  const by = (label: string) => {
    const p = proposals.find((x) => x.field.label === label);
    if (!p)
      throw new Error(
        `no field "${label}" in ${file}: ${proposals.map((x) => x.field.label).join(' | ')}`,
      );
    return p;
  };
  /** Instructions for every proposal with a value except files (jsdom cannot attach files). */
  const instructions = (labels: string[]): FillInstruction[] =>
    labels.map((label) => {
      const p = by(label);
      const action = p.value ? toFillAction(p.value) : null;
      if (!action) throw new Error(`no value for ${label}`);
      return toInstruction(p.field, action);
    });
  const win = dom.window as unknown as { submitCount: number; stepChanges?: number };
  return { doc, scan, proposals, by, instructions, win };
}

const SENSITIVE_OR_PERSONAL = new Set(['manual']);

describe('platform detection', () => {
  it('recognises application hosts and marks every platform experimental until verified live', () => {
    expect(detectFormPlatform('https://job-boards.greenhouse.io/acme/jobs/1')).toBe('greenhouse');
    expect(detectFormPlatform('https://boards.greenhouse.io/acme/jobs/1')).toBe('greenhouse');
    expect(detectFormPlatform('https://jobs.lever.co/acme/1/apply')).toBe('lever');
    expect(detectFormPlatform('https://jobs.ashbyhq.com/acme/1/application')).toBe('ashby');
    expect(detectFormPlatform('https://jobs.smartrecruiters.com/Acme/1')).toBe('smartrecruiters');
    expect(
      detectFormPlatform('https://smartapply.indeed.com/beta/indeedapply/form/contact-info'),
    ).toBe('indeed');
    expect(detectFormPlatform('https://acme.wd1.myworkdayjobs.com/x')).toBe('workday');
    expect(detectFormPlatform('https://evil-greenhouse.io.example.com/')).toBe('generic');
    expect(detectFormPlatform('not a url')).toBe('generic');
    expect(Object.values(PLATFORMS).every((p) => p.status === 'experimental')).toBe(true);
  });
});

describe('Greenhouse-style form', () => {
  const url = 'https://job-boards.greenhouse.io/acme/jobs/4012345';

  it('maps contact, documents and education, and leaves EEOC and authorization alone', () => {
    const { scan, by } = load('greenhouse-application.html', url);
    expect(scan).toMatchObject({
      platform: 'greenhouse',
      title: 'Cloud Engineering Intern',
      submitControls: ['Submit application'],
    });
    expect(by('First Name')).toMatchObject({ status: 'ready', value: { text: 'Avery' } });
    expect(by('Resume/CV')).toMatchObject({ status: 'ready', value: { type: 'file' } });
    expect(by('Cover Letter').status).toBe('unsupported');
    expect(by('School').value).toMatchObject({ type: 'choose', value: 'State University' });
    for (const label of [
      'Are you legally authorized to work in the United States?',
      'Gender',
      'Are you Hispanic/Latino?',
      'Veteran Status',
      'Disability Status',
    ]) {
      expect(SENSITIVE_OR_PERSONAL.has(by(label).status)).toBe(true);
    }
  });

  it('fills typeahead dropdowns built like react-select, and never submits', async () => {
    const { doc, instructions, win } = load('greenhouse-application.html', url);
    const report = await fillForm(
      doc,
      instructions(['First Name', 'Country', 'Location (City)', 'Degree', 'Discipline']),
      FAST,
    );
    expect(report.results.map((r) => r.status)).toEqual([
      'filled',
      'filled',
      'filled',
      'filled',
      'filled',
    ]);
    const picked = (id: string) => (doc.getElementById(id) as HTMLInputElement).dataset.selected;
    expect(picked('country')).toBe('United States');
    expect(picked('candidate-location')).toBe('Springfield, Virginia, United States');
    expect(picked('degree--0')).toBe("Bachelor's Degree");
    expect(picked('discipline--0')).toBe('Computer Science');
    expect(win.submitCount).toBe(0);
  });
});

describe('Lever-style form', () => {
  const url = 'https://jobs.lever.co/acme/7f0c/apply';

  it('maps full name, links and current company, and notices the CAPTCHA', () => {
    const { scan, by } = load('lever-application.html', url);
    expect(scan.platform).toBe('lever');
    expect(scan.captcha).toBe(true);
    expect(by('Resume/CV')).toMatchObject({ status: 'ready', value: { type: 'file' } });
    expect(by('Full name').value).toEqual({ type: 'text', text: 'Avery Chen' });
    expect(by('Current company').value).toEqual({ type: 'text', text: 'Campus IT Help Desk' });
    expect(by('GitHub URL').value).toEqual({ type: 'text', text: 'https://github.com/avery' });
    expect(by('Pronouns').status).toBe('manual');
    expect(by('Will you require sponsorship for employment visa status?').status).toBe('manual');
    expect(by('Race').status).toBe('manual');
    expect(by('Tell us about a technical problem you solved.').status).toBe('question');
    expect(by('Which AWS services have you used?').field).toMatchObject({
      control: 'checkbox-group',
      options: [{ label: 'EC2' }, { label: 'S3' }, { label: 'Lambda' }],
    });
  });

  it('fills text fields and a checkbox group the user chose', async () => {
    const { doc, scan, instructions, win } = load('lever-application.html', url);
    const aws = scan.fields.find((f) => f.control === 'checkbox-group');
    const report = await fillForm(
      doc,
      [
        ...instructions(['Full name', 'Email', 'LinkedIn URL']),
        {
          ref: aws?.ref ?? '',
          control: 'checkbox-group',
          label: aws?.label ?? '',
          action: { type: 'choose-many', values: ['EC2', 'Lambda'] },
        },
      ],
      FAST,
    );
    expect(report.results.map((r) => r.status)).toEqual(['filled', 'filled', 'filled', 'filled']);
    const checked = [
      ...doc.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked'),
    ].map((b) => b.value);
    expect(checked).toEqual(['EC2', 'Lambda']);
    expect(win.submitCount).toBe(0);
  });
});

describe('Ashby-style form', () => {
  const url = 'https://jobs.ashbyhq.com/acme/0b8e/application';

  it('reads a form without a form element and locks its Yes/No work authorization question', () => {
    const { scan, by } = load('ashby-application.html', url);
    expect(scan.platform).toBe('ashby');
    expect(scan.submitControls).toEqual(['Submit Application']);
    expect(by('Name').value).toEqual({ type: 'text', text: 'Avery Chen' });
    expect(by('Resume').value).toMatchObject({ type: 'file' });
    expect(by('Expected graduation date')).toMatchObject({
      status: 'review',
      value: { text: '2026-05-01' },
    });
    expect(by('I consent to Acme storing my information for this application.').status).toBe(
      'manual',
    );
    expect(by('Gender').status).toBe('manual');
    const authorization = by('Are you currently authorized to work in the US?');
    expect(authorization.field.control).toBe('button-group');
    expect(authorization.field.options.map((o) => o.label)).toEqual(['Yes', 'No']);
    expect(authorization).toMatchObject({ status: 'manual', value: null, approved: false });
    expect(scan.unsupportedFields).toEqual([]);
  });

  it('picks a location from the typeahead and never clicks Yes/No or Submit', async () => {
    const { doc, instructions, win } = load('ashby-application.html', url);
    const report = await fillForm(doc, instructions(['Name', 'Location', 'GitHub Profile']), FAST);
    expect(report.results.map((r) => r.status)).toEqual(['filled', 'filled', 'filled']);
    expect((doc.getElementById('loc') as HTMLInputElement).value).toBe('Springfield, VA, USA');
    expect((doc.querySelector('.yesno') as HTMLElement).dataset.answer).toBeUndefined();
    expect(win.submitCount).toBe(0);
  });
});

describe('SmartRecruiters-style form', () => {
  const url = 'https://jobs.smartrecruiters.com/oneclick-ui/company/Acme/publication/9d1e';

  it('reads fields inside web components in page order', () => {
    const { scan, by } = load('smartrecruiters-application.html', url);
    expect(scan.platform).toBe('smartrecruiters');
    expect(scan.fields.map((f) => f.label).slice(0, 3)).toEqual([
      'First name',
      'Last name',
      'Email',
    ]);
    expect(by('First name').field.section).toBe('Personal information');
    expect(by('Confirm your email').value).toEqual({ type: 'text', text: 'avery@example.com' });
    expect(scan.step.hasNext).toBe(true);
    expect(scan.submitControls).toEqual(['Next']);
    expect(scan.addControls).toEqual(['+ Add']);
  });

  it('fills inputs inside shadow roots and does not press Next', async () => {
    const { doc, instructions, win } = load('smartrecruiters-application.html', url);
    const report = await fillForm(
      doc,
      instructions(['First name', 'Phone number', 'LinkedIn']),
      FAST,
    );
    expect(report.results.map((r) => r.status)).toEqual(['filled', 'filled', 'filled']);
    const shadowValue = (name: string) =>
      [...doc.querySelectorAll('sr-input')]
        .map((host) => host.shadowRoot?.querySelector<HTMLInputElement>(`input[name="${name}"]`))
        .find(Boolean)?.value;
    expect(shadowValue('firstName')).toBe('Avery');
    expect(shadowValue('linkedin')).toBe('https://www.linkedin.com/in/averychen');
    expect(win.stepChanges).toBe(0);
  });
});

describe('Indeed Apply-style multi-step form', () => {
  const url = 'https://smartapply.indeed.com/beta/indeedapply/form/contact-info';

  it('fills one step at a time and leaves Continue to the user', async () => {
    const { doc, scan, by, instructions, win } = load('indeed-apply.html', url);
    expect(scan).toMatchObject({
      platform: 'indeed',
      step: { current: 1, total: 4, hasNext: true },
      submitControls: ['Continue'],
    });
    // The email Indeed already filled is read-only, so it is left alone.
    expect(scan.skippedCount).toBe(1);
    expect(by('City, State').value).toEqual({ type: 'text', text: 'Springfield, VA' });
    const report = await fillForm(
      doc,
      instructions(['First name', 'Last name', 'City, State', 'Phone number']),
      FAST,
    );
    expect(report.results.every((r) => r.status === 'filled')).toBe(true);
    expect(win.stepChanges).toBe(0);

    // The user presses Continue twice; the employer questions are scanned fresh.
    (doc.getElementById('continue') as HTMLButtonElement).click();
    (doc.getElementById('continue') as HTMLButtonElement).click();
    const step3 = proposeAnswers(scanForm(doc), {
      profile: sampleProfile(),
      resume: RESUME,
      coverLetter: null,
    });
    const auth = step3.find(
      (p) => p.field.label === 'Are you authorized to work in the United States?',
    );
    expect(auth).toMatchObject({ status: 'manual', value: null });
    // Years of experience is not stored, so it is left empty for the user rather than guessed.
    expect(step3.find((p) => p.field.label.startsWith('How many years'))).toMatchObject({
      status: 'unknown',
      value: null,
    });
    expect(step3.find((p) => p.field.label === 'Date available')?.status).toBe('manual');
    expect(win.submitCount).toBe(0);
  });
});
