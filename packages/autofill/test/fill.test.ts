import { describe, expect, it } from 'vitest';
import type { FillInstruction, FormScan } from '@applypilot/shared';
import { fillForm, scanForm } from '../src';
import { htmlPage, loadApplication } from './helpers';

const FAST = { optionTimeoutMs: 400, settleMs: 20 };

function instruction(
  scan: FormScan,
  label: string,
  action: FillInstruction['action'],
): FillInstruction {
  const field = scan.fields.find((f) => f.label === label);
  if (!field) throw new Error(`no field ${label}`);
  return { ref: field.ref, control: field.control, label: field.label, action };
}

describe('fillForm on a plain application', () => {
  it('fills text and selects, refuses sensitive radios and boxes even if asked, never submits', async () => {
    const { dom, doc } = loadApplication(
      'generic-application.html',
      'https://careers.northwind.example/apply/42',
    );
    const scan = scanForm(doc);
    const report = await fillForm(
      doc,
      [
        instruction(scan, 'First name', { type: 'text', value: 'Avery' }),
        instruction(scan, 'Email', { type: 'text', value: 'avery@example.com' }),
        instruction(scan, 'Cover letter', { type: 'text', value: 'Dear team,\nThank you.' }),
        instruction(scan, 'How did you hear about us?', {
          type: 'choose',
          value: 'Referral',
          label: 'Referral',
        }),
        instruction(scan, 'Veteran status', {
          type: 'choose',
          value: 'no',
          label: 'I am not a protected veteran',
        }),
        instruction(scan, 'I agree to the privacy policy', { type: 'check', checked: true }),
      ],
      FAST,
    );
    // The side panel never sends these two; the fill step refuses them anyway.
    expect(report.results.map((r) => r.status)).toEqual([
      'filled',
      'filled',
      'filled',
      'filled',
      'skipped',
      'skipped',
    ]);
    expect(
      (doc.getElementById('first-name') as HTMLInputElement | null)?.value ??
        (doc.querySelector('[name="first_name"]') as HTMLInputElement).value,
    ).toBe('Avery');
    expect(
      (doc.querySelector('textarea[name="cover_letter"], #cover-letter') as HTMLTextAreaElement)
        .value,
    ).toBe('Dear team,\nThank you.');
    expect((doc.querySelector('select[name="source"]') as HTMLSelectElement).value).toBe(
      'Referral',
    );
    expect(
      (doc.querySelector('input[name="veteran"][value="no"]') as HTMLInputElement).checked,
    ).toBe(false);
    expect((doc.querySelector('input[name="privacy"]') as HTMLInputElement).checked).toBe(false);
    expect((dom.window as unknown as { submitCount: number }).submitCount).toBe(0);
  });

  it('blocks a submission the page triggers while filling', async () => {
    const doc = htmlPage(
      '<form><input aria-label="Email" type="email"><input aria-label="Name"><button>Send</button></form>',
    );
    const form = doc.querySelector('form')!;
    let submitted = 0;
    form.addEventListener('submit', (e) => {
      submitted += 1;
      e.preventDefault();
    });
    // A page script that submits as soon as a field changes.
    doc.querySelector('input')?.addEventListener('change', () => form.requestSubmit());
    const scan = scanForm(doc);
    const report = await fillForm(
      doc,
      [instruction(scan, 'Email', { type: 'text', value: 'a@b.co' })],
      FAST,
    );
    expect(report.results[0]?.status).toBe('filled');
    expect(report.blockedSubmissions).toBe(1);
    expect(submitted).toBe(0);
    // Once filling is over, the user's own submission works again.
    form.requestSubmit();
    expect(submitted).toBe(1);
  });

  it('blocks a script clicking the submit button while filling', async () => {
    const doc = htmlPage(
      '<form><input aria-label="Email" type="email"><button id="go">Submit application</button></form>',
    );
    const form = doc.querySelector('form')!;
    let submitted = 0;
    form.addEventListener('submit', (e) => {
      submitted += 1;
      e.preventDefault();
    });
    doc.querySelector('input')?.addEventListener('input', () => doc.getElementById('go')?.click());
    const scan = scanForm(doc);
    const report = await fillForm(
      doc,
      [instruction(scan, 'Email', { type: 'text', value: 'a@b.co' })],
      FAST,
    );
    expect(report.results[0]?.status).toBe('filled');
    expect(report.blockedSubmissions).toBeGreaterThanOrEqual(1);
    expect(submitted).toBe(0);
  });

  it('refuses targets the page swapped in after the scan: passwords, hidden and sensitive fields', async () => {
    const doc = htmlPage(`
      <form>
        <label for="n">Nickname</label><input id="n">
        <label for="p">Password</label><input id="p" type="password">
        <input id="h" type="hidden" aria-label="Notes">
        <label for="i">Note</label><input id="i" style="display:none">
        <label for="q">Question</label><input id="q">
      </form>`);
    const scan = scanForm(doc);
    const nick = instruction(scan, 'Nickname', { type: 'text', value: 'avery@example.com' });
    const question = instruction(scan, 'Question', { type: 'text', value: 'Yes' });
    // A page script copies the scanned field's ref onto other inputs.
    const copy = (id: string) => ({
      ...nick,
      ref: (() => {
        const el = doc.getElementById(id)!;
        el.setAttribute('data-applypilot-ref', `${nick.ref}-${id}`);
        return `${nick.ref}-${id}`;
      })(),
    });
    // And relabels a harmless field as a work authorization question.
    doc.querySelector('label[for="q"]')!.textContent =
      'Are you legally authorized to work in the United States?';
    const report = await fillForm(
      doc,
      [
        copy('p'),
        copy('h'),
        copy('i'),
        question,
        { ...nick, label: 'Will you require visa sponsorship?' },
      ],
      FAST,
    );
    expect(report.results.map((r) => r.status)).toEqual([
      'skipped',
      'skipped',
      'skipped',
      'skipped',
      'skipped',
    ]);
    expect(report.results[0]?.message).toMatch(/never fills password/);
    expect(report.results[3]?.message).toMatch(/work authorization/);
    for (const id of ['n', 'p', 'h', 'i', 'q']) {
      expect((doc.getElementById(id) as HTMLInputElement).value).toBe('');
    }
  });

  it('reports fields that changed or disappeared since the scan', async () => {
    const { doc } = loadApplication(
      'generic-application.html',
      'https://careers.northwind.example/apply/42',
    );
    const scan = scanForm(doc);
    const phone = instruction(scan, 'Phone', { type: 'text', value: '+1 555 0100' });
    const github = instruction(scan, 'GitHub', { type: 'text', value: 'https://github.com/avery' });
    doc.querySelector(`[data-applypilot-ref="${phone.ref}"]`)?.remove();
    const githubLabel = [...doc.querySelectorAll('label')].find((l) =>
      l.textContent.includes('GitHub'),
    );
    if (githubLabel) githubLabel.textContent = 'Twitter';
    const report = await fillForm(doc, [phone, github], FAST);
    expect(report.results).toEqual([
      {
        ref: phone.ref,
        status: 'failed',
        message: 'The field is no longer on the page. Scan again.',
      },
      {
        ref: github.ref,
        status: 'failed',
        message: 'The page changed since the scan. Scan again.',
      },
    ]);
  });

  it('does not attach a file where the browser cannot', async () => {
    const { doc } = loadApplication(
      'generic-application.html',
      'https://careers.northwind.example/apply/42',
    );
    const scan = scanForm(doc);
    const report = await fillForm(
      doc,
      [
        instruction(scan, 'Resume/CV', {
          type: 'file',
          fileName: 'r.pdf',
          mimeType: 'application/pdf',
          base64: 'JVBERi0=',
        }),
      ],
      FAST,
    );
    // jsdom has no DataTransfer; Chrome does (covered by the browser tests).
    expect(report.results[0]).toMatchObject({ status: 'unsupported' });
  });
});

describe('fillForm on a Workday-style form', () => {
  const url = 'https://acme.wd5.myworkdayjobs.com/en-US/careers/job/x/apply';

  it('opens custom dropdowns, picks options, and reports a conditional question', async () => {
    const { dom, doc } = loadApplication('workday-application.html', url);
    const scan = scanForm(doc);
    const report = await fillForm(
      doc,
      [
        instruction(scan, 'Country', {
          type: 'choose',
          value: 'United States of America',
          label: 'United States of America',
        }),
        instruction(scan, 'State', { type: 'choose', value: 'Virginia', label: 'Virginia' }),
        instruction(scan, 'How Did You Hear About Us?', {
          type: 'choose',
          value: 'Referral',
          label: 'Referral',
        }),
        instruction(scan, 'Phone Device Type', { type: 'choose', value: 'Pager', label: 'Pager' }),
      ],
      FAST,
    );
    expect(report.results.map((r) => r.status)).toEqual(['filled', 'filled', 'filled', 'failed']);
    expect(doc.getElementById('country-btn')?.textContent).toBe('United States of America');
    expect(doc.getElementById('state-btn')?.textContent).toBe('Virginia');
    expect(report.newFields).toBe(1);
    expect(doc.getElementById('ref')).not.toBeNull();
    expect(doc.getElementById('device-list')?.hidden).toBe(true);
    const win = dom.window as unknown as { submitCount: number; stepChanges: number };
    expect(win.stepChanges).toBe(0);
    expect(win.submitCount).toBe(0);
  });

  it('types into a typeahead and picks the option that loads', async () => {
    const { doc } = loadApplication('workday-application.html', url);
    (doc.querySelector('#next') as HTMLButtonElement).click();
    const scan = scanForm(doc);
    const report = await fillForm(
      doc,
      [
        instruction(scan, 'Field of Study', {
          type: 'choose',
          value: 'Computer Science',
          label: 'Computer Science',
        }),
        instruction(scan, 'Degree', {
          type: 'choose',
          value: "Bachelor's Degree",
          label: "Bachelor's Degree",
        }),
      ],
      FAST,
    );
    expect(report.results.map((r) => r.status)).toEqual(['filled', 'filled']);
    expect((doc.getElementById('fos') as HTMLInputElement).dataset.picked).toBe('Computer Science');
  });

  it('fills both work experience blocks by their own refs', async () => {
    const { doc } = loadApplication('workday-application.html', url);
    (doc.querySelector('#next') as HTMLButtonElement).click();
    const scan = scanForm(doc);
    const titles = scan.fields.filter((f) => f.label === 'Job Title');
    const current = scan.fields.filter((f) => f.label === 'I currently work here');
    const report = await fillForm(
      doc,
      [
        {
          ref: titles[0]!.ref,
          control: 'text',
          label: 'Job Title',
          action: { type: 'text', value: 'Cloud Support Intern' },
        },
        {
          ref: titles[1]!.ref,
          control: 'text',
          label: 'Job Title',
          action: { type: 'text', value: 'IT Support Assistant' },
        },
        {
          ref: current[1]!.ref,
          control: 'checkbox',
          label: 'I currently work here',
          action: { type: 'check', checked: true },
        },
      ],
      FAST,
    );
    expect(report.results.every((r) => r.status === 'filled')).toBe(true);
    expect((doc.getElementById('t1') as HTMLInputElement).value).toBe('Cloud Support Intern');
    expect((doc.getElementById('t2') as HTMLInputElement).value).toBe('IT Support Assistant');
    expect((doc.querySelectorAll('.job-block')[1] as HTMLElement).dataset.current).toBe('true');
  });

  it('fills an ARIA radio group on a later step', async () => {
    const { doc } = loadApplication('workday-application.html', url);
    (doc.querySelector('#next') as HTMLButtonElement).click();
    (doc.querySelector('#next') as HTMLButtonElement).click();
    const scan = scanForm(doc);
    expect(scan.step).toMatchObject({ current: 3, total: 4 });
    const group = scan.fields.find((f) => f.control === 'radio-group');
    expect(group).toBeDefined();
    const no = group!.options.find((o) => o.label === 'No')!;
    const report = await fillForm(
      doc,
      [
        {
          ref: group!.ref,
          control: 'radio-group',
          label: group!.label,
          action: { type: 'choose', ...no },
        },
      ],
      FAST,
    );
    expect(report.results[0]?.status).toBe('filled');
  });
});

describe('fillForm safety', () => {
  it('never clicks an option that is really a submit button', async () => {
    const doc = htmlPage(`
      <form id="f"><label for="b">Plan</label>
        <button type="button" id="b" aria-haspopup="listbox" aria-controls="l">Select</button>
        <input aria-label="Other">
      </form>
      <div id="l" role="listbox"><button role="option" type="submit" form="f">Submit application</button></div>`);
    let submitted = 0;
    doc.getElementById('f')?.addEventListener('submit', (e) => {
      submitted += 1;
      e.preventDefault();
    });
    const scan = scanForm(doc);
    const report = await fillForm(
      doc,
      [
        instruction(scan, 'Plan', {
          type: 'choose',
          value: 'Submit application',
          label: 'Submit application',
        }),
      ],
      FAST,
    );
    expect(report.results[0]?.status).toBe('unsupported');
    expect(submitted).toBe(0);
  });

  it('refuses to open a dropdown whose trigger is a submit button', async () => {
    const doc = htmlPage(`
      <form><label for="b">Next step</label>
        <button id="b" aria-haspopup="listbox" aria-controls="l">Continue</button><input aria-label="A">
      </form><ul id="l" role="listbox"><li role="option">One</li></ul>`);
    const scan = scanForm(doc);
    const field = scan.fields.find((f) => f.control === 'listbox-button');
    expect(field).toBeDefined();
    const report = await fillForm(
      doc,
      [
        {
          ref: field!.ref,
          control: 'listbox-button',
          label: field!.label,
          action: { type: 'choose', value: 'One', label: 'One' },
        },
      ],
      FAST,
    );
    expect(report.results[0]?.status).toBe('unsupported');
  });

  it('leaves a typeahead as it was when no option matches', async () => {
    const doc = htmlPage(
      '<form><input role="combobox" aria-label="School" aria-controls="l" value="old"><input aria-label="B"><ul id="l" role="listbox"></ul></form>',
    );
    const scan = scanForm(doc);
    const report = await fillForm(
      doc,
      [instruction(scan, 'School', { type: 'choose', value: 'MIT', label: 'MIT' })],
      FAST,
    );
    expect(report.results[0]?.status).toBe('failed');
    expect((doc.querySelector('[role="combobox"]') as HTMLInputElement).value).toBe('old');
  });
});
