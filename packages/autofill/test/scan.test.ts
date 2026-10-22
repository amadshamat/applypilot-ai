import { describe, expect, it } from 'vitest';
import { formScanSchema } from '@applypilot/shared';
import { REF_ATTRIBUTE, classifyField, scanForm } from '../src';
import { htmlPage, loadApplication } from './helpers';

const NOW = () => new Date('2026-10-22T12:00:00.000Z');

describe('scanForm on a plain HTML application', () => {
  const { doc } = loadApplication(
    'generic-application.html',
    'https://careers.northwind.example/apply/42',
  );
  const scan = scanForm(doc, { now: NOW });
  const byLabel = (label: string) => scan.fields.find((f) => f.label === label);

  it('finds the application form, not the search box, and validates', () => {
    expect(formScanSchema.safeParse(scan).success).toBe(true);
    expect(scan.platform).toBe('generic');
    expect(scan.title).toBe('Apply for Cloud Engineering Intern');
    expect(scan.fields.some((f) => f.label === 'Search jobs')).toBe(false);
  });

  it('describes each control with its label, section and options', () => {
    expect(byLabel('First name')).toMatchObject({
      control: 'text',
      required: true,
      section: 'Your details',
    });
    expect(byLabel('Email')).toMatchObject({ control: 'email', required: true });
    expect(byLabel('Phone')).toMatchObject({ control: 'tel' });
    expect(byLabel('Resume/CV')).toMatchObject({
      control: 'file',
      accept: '.pdf,.docx',
      section: 'Documents',
    });
    expect(byLabel('How did you hear about us?')).toMatchObject({
      control: 'select',
      options: [
        { value: 'LinkedIn', label: 'LinkedIn' },
        { value: 'Job board', label: 'Job board' },
        { value: 'Referral', label: 'Referral' },
      ],
    });
    expect(byLabel('Are you legally authorized to work in the United States?')).toMatchObject({
      control: 'radio-group',
      required: true,
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
      ],
    });
    expect(byLabel('I agree to the privacy policy')).toMatchObject({
      control: 'checkbox',
      required: true,
    });
  });

  it('skips passwords, hidden fields and honeypots', () => {
    expect(scan.fields.some((f) => /password|old field/i.test(f.label))).toBe(false);
    expect(scan.fields.some((f) => f.name.includes('hp'))).toBe(false);
    // Only the visible password counts; hidden fields and honeypots are simply not fields.
    expect(scan.skippedCount).toBe(1);
  });

  it('lists the submit button it will never click', () => {
    expect(scan.submitControls).toEqual(['Submit application']);
    expect(scan.captcha).toBe(false);
  });

  it('marks each field on the page so the fill step can find it', () => {
    const ref = byLabel('Email')!.ref;
    expect(doc.querySelector(`[${REF_ATTRIBUTE}="${ref}"]`)?.id).toBe('email');
    const radios = doc.querySelectorAll(`[${REF_ATTRIBUTE}="${byLabel('Veteran status')!.ref}"]`);
    expect(radios).toHaveLength(2);
  });

  it('classifies contact fields, documents and questions', () => {
    const kinds = Object.fromEntries(scan.fields.map((f) => [f.label, classifyField(f).kind]));
    expect(kinds).toMatchObject({
      'First name': 'name.first',
      'Last name': 'name.last',
      Email: 'email',
      Phone: 'phone',
      'Location (city, state)': 'location.full',
      'LinkedIn profile': 'link.linkedin',
      GitHub: 'link.github',
      'Portfolio or personal website': 'link.portfolio',
      'Resume/CV': 'document.resume',
      'Cover letter': 'document.cover-letter-text',
      'Why do you want to work at Northwind?': 'question',
    });
  });

  it('keeps sensitive and personal questions for the user', () => {
    const manual = (label: string) => classifyField(byLabel(label)!);
    expect(manual('Are you legally authorized to work in the United States?')).toMatchObject({
      kind: 'manual.sensitive',
      topic: 'work authorization',
    });
    expect(manual('Will you now or in the future require visa sponsorship?').kind).toBe(
      'manual.sensitive',
    );
    expect(manual('Gender')).toMatchObject({
      kind: 'manual.sensitive',
      topic: 'demographic information',
    });
    expect(manual('Veteran status').kind).toBe('manual.sensitive');
    expect(manual('I agree to the privacy policy').kind).toBe('manual.sensitive');
    expect(manual('Desired salary')).toMatchObject({
      kind: 'manual.personal',
      topic: 'pay expectations',
    });
    expect(manual('When can you start?')).toMatchObject({
      kind: 'manual.personal',
      topic: 'availability',
    });
    expect(manual('How did you hear about us?').kind).toBe('manual.personal');
  });
});

describe('scanForm on a multi-step form with custom controls (Workday-style)', () => {
  const url = 'https://acme.wd5.myworkdayjobs.com/en-US/careers/job/Cloud-Support-Intern/apply';

  it('reports the step, custom dropdowns, and the buttons it will not click', () => {
    const { doc } = loadApplication('workday-application.html', url);
    const scan = scanForm(doc, { now: NOW });
    expect(scan.platform).toBe('workday');
    expect(scan.step).toEqual({ current: 1, total: 4, hasNext: true });
    expect(scan.submitControls).toContain('Save and Continue');
    const hear = scan.fields.find((f) => f.label === 'How Did You Hear About Us?');
    expect(hear).toMatchObject({
      control: 'listbox-button',
      required: true,
      currentValue: 'Select One',
    });
    expect(hear?.options.map((o) => o.label)).toContain('University Career Fair');
    // Only the visible step is scanned.
    expect(scan.fields.some((f) => f.label === 'Job Title')).toBe(false);
    expect(scan.fields.find((f) => f.label === 'First Name')).toMatchObject({
      section: 'Legal Name',
    });
    expect(scan.fields.find((f) => f.label === 'First Name')?.name).toContain('first name');
  });

  it('numbers repeated work experience blocks', () => {
    const { doc } = loadApplication('workday-application.html', url);
    (doc.querySelector('#next') as HTMLButtonElement).click();
    const scan = scanForm(doc, { now: NOW });
    const titles = scan.fields.filter((f) => f.label === 'Job Title');
    expect(titles.map((f) => f.repeatIndex)).toEqual([0, 1]);
    expect(titles.map((f) => classifyField(f).kind)).toEqual([
      'experience.title',
      'experience.title',
    ]);
    const fos = scan.fields.find((f) => f.label === 'Field of Study');
    // Its options only load while typing, so the list is not known up front.
    expect(fos).toMatchObject({ control: 'combobox', optionsComplete: false });
    expect(classifyField(fos!).kind).toBe('education.field');
    expect(scan.addControls).toEqual(['Add Another']);
    const month = scan.fields.find((f) => f.label === 'From (Month)')!;
    expect(classifyField(month)).toMatchObject({ kind: 'experience.start', datePart: 'month' });
  });
});

describe('scanForm details', () => {
  it('reads labels from aria-labelledby, wrapping labels and nearby text', () => {
    const doc = htmlPage(`
      <form>
        <span id="l1">Preferred email</span><input aria-labelledby="l1">
        <label>Phone number <input name="p"></label>
        <div><div class="lbl">LinkedIn URL</div><div><input name="x"></div></div>
      </form>`);
    const labels = scanForm(doc).fields.map((f) => f.label);
    expect(labels).toEqual(['Preferred email', 'Phone number', 'LinkedIn URL']);
  });

  it('names a radio group by its question, not by a section legend shared with other fields', () => {
    // Regression (practice form, 2026-10-22): the legend "Eligibility" named the
    // work authorization radios, which hid the question and left it unlocked.
    const doc = htmlPage(`
      <form>
        <fieldset><legend>Eligibility</legend>
          <p><strong>Are you legally authorized to work in the United States?</strong></p>
          <label><input type="radio" name="auth" value="yes"> Yes</label>
          <label><input type="radio" name="auth" value="no"> No</label>
          <label for="s">Will you require visa sponsorship?</label><select id="s"><option>No</option></select>
        </fieldset>
        <fieldset><legend>Do you have a driver's license?</legend>
          <label><input type="radio" name="dl" value="yes"> Yes</label>
          <label><input type="radio" name="dl" value="no"> No</label>
        </fieldset>
      </form>`);
    const fields = scanForm(doc).fields;
    const auth = fields.find((f) => f.control === 'radio-group' && f.name === 'auth');
    expect(auth?.label).toBe('Are you legally authorized to work in the United States?');
    expect(classifyField(auth!)).toMatchObject({
      kind: 'manual.sensitive',
      topic: 'work authorization',
    });
    expect(fields.find((f) => f.name === 'dl')?.label).toBe("Do you have a driver's license?");
  });

  it('notices CAPTCHAs and application frames from other sites', () => {
    const doc = htmlPage(`
      <form><input name="a" aria-label="A"><input name="b" aria-label="B"></form>
      <div class="g-recaptcha" data-sitekey="x"></div>
      <iframe src="https://job-boards.greenhouse.io/embed/job_app?for=acme&token=1"></iframe>`);
    Object.defineProperty(doc.querySelector('iframe')!, 'contentDocument', { get: () => null });
    const scan = scanForm(doc);
    expect(scan.captcha).toBe(true);
    expect(scan.blockedFrames).toEqual([
      {
        origin: 'https://job-boards.greenhouse.io',
        url: 'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=1',
      },
    ]);
  });

  it('reads fields inside open shadow roots', () => {
    const doc = htmlPage(
      '<form><input aria-label="Email" name="email"></form><apply-widget></apply-widget>',
    );
    const host = doc.querySelector('apply-widget')!;
    host.attachShadow({ mode: 'open' }).innerHTML = '<label for="c">City</label><input id="c">';
    expect(scanForm(doc).fields.map((f) => f.label)).toContain('City');
  });

  it('re-numbers fields on every scan', () => {
    const doc = htmlPage('<form><input aria-label="A"><input aria-label="B"></form>');
    scanForm(doc);
    doc.querySelector('form')!.insertAdjacentHTML('afterbegin', '<input aria-label="Z">');
    const scan = scanForm(doc);
    expect(scan.fields.map((f) => `${f.ref}:${f.label}`)).toEqual(['f1:Z', 'f2:A', 'f3:B']);
  });
});
