import { describe, expect, it } from 'vitest';
import type { DetectedField } from '@applypilot/shared';
import {
  matchOption,
  parseLocation,
  proposeAnswers,
  proposeField,
  scanForm,
  toFillAction,
} from '../src';
import { loadApplication, sampleProfile } from './helpers';

const RESUME = {
  id: 'r1',
  fileName: 'Avery_Chen_Resume.pdf',
  text: 'Avery Chen\nCloud support intern',
};

function field(overrides: Partial<DetectedField>): DetectedField {
  return {
    ref: 'f1',
    control: 'text',
    label: '',
    hint: '',
    section: '',
    name: '',
    autocomplete: '',
    required: false,
    options: [],
    optionsComplete: true,
    currentValue: '',
    accept: '',
    maxLength: null,
    repeatIndex: null,
    ...overrides,
  };
}

const context = () => ({ profile: sampleProfile(), resume: RESUME, coverLetter: null });

describe('proposeAnswers on a plain application', () => {
  const { doc } = loadApplication(
    'generic-application.html',
    'https://careers.northwind.example/apply/42',
  );
  const proposals = proposeAnswers(scanForm(doc), context());
  const by = (label: string) => {
    const p = proposals.find((x) => x.field.label === label);
    if (!p) throw new Error(`no proposal for ${label}`);
    return p;
  };

  it('fills contact details and links from the profile, selected by default', () => {
    expect(by('First name')).toMatchObject({
      status: 'ready',
      approved: true,
      value: { type: 'text', text: 'Avery' },
      source: 'Profile · Name',
    });
    expect(by('Last name').value).toEqual({ type: 'text', text: 'Chen' });
    expect(by('Email')).toMatchObject({ status: 'ready', value: { text: 'avery@example.com' } });
    expect(by('Location (city, state)').value).toEqual({ type: 'text', text: 'Springfield, VA' });
    expect(by('GitHub').value).toEqual({ type: 'text', text: 'https://github.com/avery' });
  });

  it('attaches the uploaded resume file', () => {
    expect(by('Resume/CV')).toMatchObject({
      status: 'ready',
      approved: true,
      value: { type: 'file', resumeId: 'r1', fileName: 'Avery_Chen_Resume.pdf' },
    });
  });

  it('never proposes answers for sensitive or personal questions', () => {
    for (const label of [
      'Are you legally authorized to work in the United States?',
      'Will you now or in the future require visa sponsorship?',
      'Gender',
      'Veteran status',
      'I agree to the privacy policy',
      'Desired salary',
      'When can you start?',
    ]) {
      expect(by(label)).toMatchObject({ status: 'manual', value: null, approved: false });
    }
    // Even an answer typed or drafted for a sensitive field is ignored.
    const scan = scanForm(doc);
    const auth = scan.fields.find((f) => f.label.startsWith('Are you legally'));
    const withAnswer = proposeAnswers(scan, {
      ...context(),
      answers: { [auth?.ref ?? '']: { text: 'Yes', source: 'Typed' } },
    });
    expect(withAnswer.find((p) => p.field.ref === auth?.ref)).toMatchObject({
      status: 'manual',
      value: null,
    });
  });

  it('leaves open questions empty until the user drafts or types an answer', () => {
    expect(by('Why do you want to work at Northwind?')).toMatchObject({
      status: 'question',
      value: null,
      approved: false,
    });
    const scan = scanForm(doc);
    const why = scan.fields.find((f) => f.label.startsWith('Why do you want'));
    const drafted = proposeAnswers(scan, {
      ...context(),
      answers: {
        [why?.ref ?? '']: {
          text: 'I want to build reliable cloud systems.',
          source: 'AI Tailor draft',
        },
      },
    });
    expect(drafted.find((p) => p.field.ref === why?.ref)).toMatchObject({
      status: 'review',
      approved: false,
      source: 'AI Tailor draft',
      value: { type: 'text', text: 'I want to build reliable cloud systems.' },
    });
  });

  it('says what is missing instead of inventing it', () => {
    expect(by('Cover letter')).toMatchObject({ status: 'missing', value: null });
    expect(by('Cover letter').note).toMatch(/AI Tailor/);
    const noResume = proposeAnswers(scanForm(doc), { ...context(), resume: null });
    expect(noResume.find((p) => p.field.label === 'Resume/CV')).toMatchObject({
      status: 'missing',
      value: null,
    });
    const empty = context();
    empty.profile.personal.phone = '';
    expect(
      proposeAnswers(scanForm(doc), empty).find((p) => p.field.label === 'Phone'),
    ).toMatchObject({ status: 'missing' });
  });

  it('uses the saved cover letter only as a draft to review', () => {
    const p = proposeAnswers(scanForm(doc), { ...context(), coverLetter: 'Dear team, ...' }).find(
      (x) => x.field.label === 'Cover letter',
    );
    expect(p).toMatchObject({
      status: 'review',
      approved: false,
      value: { text: 'Dear team, ...' },
    });
  });
});

describe('proposeAnswers on a Workday-style form', () => {
  const url = 'https://acme.wd5.myworkdayjobs.com/en-US/careers/job/x/apply';

  it('splits the location into country, state and postal code', () => {
    const { doc } = loadApplication('workday-application.html', url);
    const proposals = proposeAnswers(scanForm(doc), context());
    const by = (label: string) => proposals.find((p) => p.field.label === label);
    expect(by('City')?.value).toEqual({ type: 'text', text: 'Springfield' });
    expect(by('Postal Code')?.value).toEqual({ type: 'text', text: '22150' });
    expect(by('Country')).toMatchObject({
      status: 'review',
      value: { type: 'choose', label: 'United States of America' },
    });
    expect(by('Country')?.note).toMatch(/Inferred/);
    expect(by('State')).toMatchObject({
      status: 'ready',
      value: { type: 'choose', label: 'Virginia' },
    });
    expect(by('How Did You Hear About Us?')).toMatchObject({ status: 'manual' });
    expect(by('Phone Device Type')?.status).not.toBe('ready');
  });

  it('maps each work experience block to the matching job', () => {
    const { doc } = loadApplication('workday-application.html', url);
    (doc.querySelector('#next') as HTMLButtonElement).click();
    const proposals = proposeAnswers(scanForm(doc), context());
    const values = (label: string) =>
      proposals
        .filter((p) => p.field.label === label)
        .map((p) => (p.value?.type === 'text' ? p.value.text : p.value));
    expect(values('Job Title')).toEqual(['Cloud Support Intern', 'IT Support Assistant']);
    expect(values('Company')).toEqual(['Northwind Logistics', 'Campus IT Help Desk']);
    expect(values('From (Month)')).toEqual(['06', '09']);
    expect(values('From (Year)')).toEqual(['2025', '2024']);
    expect(values('I currently work here')).toEqual([
      { type: 'check', checked: false },
      { type: 'check', checked: true },
    ]);
    expect(values('Role Description')[0]).toBe(
      '- Automated EC2 snapshot cleanup with Python\n- Wrote runbooks for 12 support tickets',
    );
    const degree = proposals.find((p) => p.field.label === 'Degree');
    expect(degree).toMatchObject({ value: { type: 'choose', label: "Bachelor's Degree" } });
    expect(proposals.find((p) => p.field.label === 'Field of Study')?.value).toMatchObject({
      type: 'choose',
      value: 'Computer Science',
    });
  });

  it('reports a third job block the profile does not have', () => {
    const p = proposeField(
      field({ label: 'Company', section: 'Work Experience 3', repeatIndex: 2 }),
      0,
      context(),
    );
    expect(p).toMatchObject({ status: 'missing', value: null });
    expect(p.note).toMatch(/2 jobs/);
  });
});

describe('proposeField details', () => {
  it('does not refill what the page already shows, and flags replacing other text', () => {
    expect(
      proposeField(
        field({ label: 'Email', control: 'email', currentValue: 'avery@example.com' }),
        0,
        context(),
      ).status,
    ).toBe('done');
    const other = proposeField(
      field({ label: 'Email', control: 'email', currentValue: 'old@example.com' }),
      0,
      context(),
    );
    expect(other).toMatchObject({ status: 'review', approved: false });
    expect(other.note).toMatch(/already shows "old@example.com"/);
  });

  it('asks the user to pick when no option clearly matches', () => {
    const p = proposeField(
      field({
        label: 'Country',
        control: 'select',
        options: [
          { value: 'ca', label: 'Canada' },
          { value: 'mx', label: 'Mexico' },
        ],
      }),
      0,
      context(),
    );
    expect(p).toMatchObject({ status: 'review', value: null, approved: false });
  });

  it('refuses values longer than the field allows', () => {
    const p = proposeField(
      field({ label: 'LinkedIn', control: 'url', maxLength: 10 }),
      0,
      context(),
    );
    expect(p).toMatchObject({ status: 'review', value: null });
  });

  it('leaves unknown fields and cover letter files to the user', () => {
    expect(proposeField(field({ label: 'Favourite colour' }), 0, context())).toMatchObject({
      status: 'unknown',
      value: null,
    });
    expect(
      proposeField(field({ label: 'Cover letter', control: 'file' }), 0, context()),
    ).toMatchObject({ status: 'unsupported' });
    expect(proposeField(field({ label: 'Street address' }), 0, context())).toMatchObject({
      status: 'missing',
      value: null,
    });
  });

  it('marks AI-suggested mappings for review', () => {
    const f = field({ ref: 'f9', label: 'Handle on the code hosting site' });
    const p = proposeAnswers(
      {
        url: '',
        platform: 'generic',
        title: '',
        fields: [f],
        skippedCount: 0,
        unsupportedFields: [],
        step: { current: null, total: null, hasNext: false },
        captcha: false,
        submitControls: [],
        addControls: [],
        blockedFrames: [],
        scannedAt: '',
      },
      {
        ...context(),
        aiClassifications: {
          f9: {
            kind: 'link.github',
            confidence: 'medium',
            reason: 'AI',
            topic: '',
            datePart: null,
            source: 'ai',
          },
        },
      },
    )[0];
    expect(p).toMatchObject({
      status: 'review',
      approved: false,
      value: { text: 'https://github.com/avery' },
    });
    expect(p?.note).toMatch(/AI suggested/);
  });

  it('formats dates for the control', () => {
    const start = (overrides: Partial<DetectedField>) =>
      proposeField(
        field({ label: 'Start date', section: 'Experience', repeatIndex: 0, ...overrides }),
        0,
        context(),
      );
    expect(start({ control: 'month' }).value).toEqual({ type: 'text', text: '2025-06' });
    expect(start({ control: 'date' })).toMatchObject({
      status: 'review',
      value: { text: '2025-06-01' },
    });
    expect(start({ hint: 'MM/YYYY' }).value).toEqual({ type: 'text', text: '06/2025' });
  });

  it('builds fill actions only from approved values', () => {
    expect(toFillAction({ type: 'text', text: 'x' })).toEqual({ type: 'text', value: 'x' });
    expect(toFillAction({ type: 'file', resumeId: 'r', fileName: 'a.pdf' })).toBeNull();
  });
});

describe('option matching', () => {
  const opts = (...labels: string[]) => labels.map((l) => ({ value: l.toLowerCase(), label: l }));

  it('matches synonyms, abbreviations and months', () => {
    expect(
      matchOption(opts('Canada', 'United States of America'), ['United States'])?.option.label,
    ).toBe('United States of America');
    expect(matchOption(opts('Maryland', 'Virginia'), ['VA'])?.option.label).toBe('Virginia');
    expect(matchOption(opts('January', 'February', 'March'), ['3'])?.option.label).toBe('March');
    expect(
      matchOption(opts("Associate's", "Bachelor's Degree", "Master's Degree"), [
        'B.S. Computer Science',
      ])?.option.label,
    ).toBe("Bachelor's Degree");
    expect(matchOption(opts('Yes', 'No'), ['yes'])?.exact).toBe(true);
  });

  it('picks nothing when unsure', () => {
    expect(matchOption(opts('Alpha', 'Beta'), ['Gamma'])).toBeNull();
    expect(matchOption(opts('Cloud team A', 'Cloud team B'), ['Cloud team'])).toBeNull();
  });

  it('parses locations', () => {
    expect(parseLocation('Toronto, ON, Canada')).toMatchObject({
      city: 'Toronto',
      state: 'ON',
      country: 'Canada',
    });
    expect(parseLocation('Austin, Texas')).toMatchObject({
      state: 'TX',
      stateName: 'Texas',
      country: 'United States',
      countryInferred: true,
    });
  });
});
