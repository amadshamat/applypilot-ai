import { resolve } from 'node:path';
import { test as base, chromium, expect, type BrowserContext, type Page } from '@playwright/test';

/**
 * Loads the e2e build (apps/extension/dist-e2e) into real Chromium. The e2e
 * build differs from release only by host access to http://127.0.0.1, which
 * stands in for the user's toolbar click (activeTab) that automation cannot do.
 */
const EXTENSION_PATH = resolve(import.meta.dirname, '../../apps/extension/dist-e2e');
const FIXTURES = `http://127.0.0.1:${process.env.FIXTURE_PORT ?? 4173}`;
const RESUMES = resolve(import.meta.dirname, '../fixtures/resumes');
const API_URL = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 8799}`;
const API_TOKEN = 'e2e-local-token-0123456789abcdef';
const MAPPED_HOSTS = [
  'www.indeed.com',
  'jobs.indeed.com',
  'smartapply.indeed.com',
  'job-boards.greenhouse.io',
  'jobs.lever.co',
  'jobs.ashbyhq.com',
  'jobs.smartrecruiters.com',
  'acme.wd5.myworkdayjobs.com',
];

const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        // Serve the Indeed fixtures under Indeed's hostnames so the adapter matches;
        // jobs.indeed.com is a separate origin, like Indeed's embedded job frames.
        // The sample application forms are served under each platform's hostname too.
        `--host-resolver-rules=${MAPPED_HOSTS.map((h) => `MAP ${h} 127.0.0.1`).join(', ')}`,
      ],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(new URL(worker.url()).host);
  },
});

async function openPanel(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  return page;
}

test('service worker starts and answers typed messages', async ({ context, extensionId }) => {
  const panel = await openPanel(context, extensionId);
  const reply = await panel.evaluate((): Promise<unknown> =>
    chrome.runtime.sendMessage({ type: 'app/ping' }),
  );
  expect(reply).toEqual({ ok: true, data: { version: '0.4.1' } });
  const rejected = await panel.evaluate((): Promise<unknown> =>
    chrome.runtime.sendMessage({ type: 'job/submit' }),
  );
  expect(rejected).toMatchObject({ ok: false, error: { code: 'INVALID_MESSAGE' } });
});

test('side panel renders and navigates', async ({ context, extensionId }) => {
  const panel = await openPanel(context, extensionId);
  await expect(panel.getByRole('tab')).toHaveCount(6);
  await panel.getByRole('tab', { name: 'Applications' }).click();
  await expect(panel.getByRole('tabpanel')).toContainText('Not built yet');
  await panel.getByRole('tab', { name: 'Profile' }).click();
  await expect(panel.getByRole('heading', { name: 'Your profile' })).toBeVisible();
  await panel.getByRole('tab', { name: 'Settings' }).click();
  await expect(panel.getByRole('switch', { name: 'Allow AI processing' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
});

test('settings persist across extension pages', async ({ context, extensionId }) => {
  const panel = await openPanel(context, extensionId);
  await panel.getByRole('tab', { name: 'Settings' }).click();
  await panel.getByLabel('Theme').selectOption('dark');
  await panel.getByRole('button', { name: 'Save settings' }).click();
  await expect(panel.getByText('Settings saved')).toBeVisible();
  await expect(panel.locator('html')).toHaveClass(/dark/);

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(options.getByLabel('Theme')).toHaveValue('dark');
});

test('analyzes a job posting in the active tab', async ({ context, extensionId }) => {
  const panel = await openPanel(context, extensionId);
  const job = await context.newPage();
  await job.goto(`${FIXTURES}/jobs/json-ld-cloud-intern.html`);
  await job.bringToFront();

  await panel.getByRole('button', { name: 'Analyze this page' }).click();
  await expect(panel.getByRole('heading', { name: 'Cloud Engineering Intern' })).toBeVisible();
  await expect(panel.getByText('$28 – $34 per hour')).toBeVisible();
  await expect(panel.getByRole('list', { name: 'Skills' })).toContainText('Terraform');

  // Extraction only reads the page.
  await expect(job.locator('h1')).toHaveText('Cloud Engineering Intern');
});

test('analyzes the selected job on an Indeed search page', async ({ context, extensionId }) => {
  const panel = await openPanel(context, extensionId);
  const port = process.env.FIXTURE_PORT ?? '4173';
  const job = await context.newPage();
  await job.goto(
    `http://www.indeed.com:${port}/jobs/indeed-search-selected-job.html?vjk=7c1e5f0a2b3d4e6f`,
  );
  await job.bringToFront();

  await panel.getByRole('button', { name: 'Analyze this page' }).click();
  await expect(
    panel.getByRole('heading', {
      name: 'Fundraiser – $20/hr Guaranteed – Great for Students & Creatives',
    }),
  ).toBeVisible();
  await expect(panel.getByText('Hello, Jordan')).toHaveCount(0);
  await expect(panel.getByText('From $20 per hour')).toBeVisible();
  await expect(panel.getByText('Part-time, Full-time').first()).toBeVisible();
  await expect(panel.getByText('Arlington, VA', { exact: true })).toBeVisible();
});

test('reads only the selected Indeed job from its details frame, and follows a switch', async ({
  context,
  extensionId,
}) => {
  // Regression for the Sunstates Security report: the page title and other
  // result cards were mixed into the analysis.
  const panel = await openPanel(context, extensionId);
  const port = process.env.FIXTURE_PORT ?? '4173';
  const job = await context.newPage();
  await job.goto(
    `http://www.indeed.com:${port}/jobs/indeed-search-frame-panel.html?q=security+officer&vjk=b5e7a1c3d9f20486`,
  );
  await expect(
    job.frameLocator('#vjs-container-iframe').getByRole('heading', {
      name: /FT Unarmed Security Officer/,
    }),
  ).toBeVisible();
  await job.bringToFront();

  await panel.getByRole('button', { name: 'Analyze this page' }).click();
  await expect(
    panel.getByRole('heading', { name: 'FT Unarmed Security Officer – $20.89/hr' }),
  ).toBeVisible();
  await expect(panel.getByText('Alexandria, VA', { exact: true })).toBeVisible();
  await expect(panel.getByText('$20.89 per hour', { exact: true })).toBeVisible();
  await expect(panel.getByText('Sunstates Security').first()).toBeVisible();
  await expect(panel.getByText(/Job Search/)).toHaveCount(0);
  await expect(panel.getByText(/Z S Connections/)).toHaveCount(0);
  await expect(panel.getByText(/No job is open/)).toHaveCount(0);

  // Pick another job the way Indeed does: the address changes at once, the
  // details frame loads the new job a moment later.
  await job.evaluate(() => {
    const zs = '3c9d2e8f71a04b65';
    history.pushState({}, '', location.href.replace(/vjk=[a-f0-9]+/, `vjk=${zs}`));
    for (const card of document.querySelectorAll('.job_seen_beacon')) {
      card.classList.toggle('vjs-highlight', card.getAttribute('data-jk') === zs);
    }
    setTimeout(() => {
      document.querySelector<HTMLIFrameElement>('#vjs-container-iframe')!.src =
        `/jobs/indeed-embedded-zs-connections.html?jk=${zs}&viewtype=embedded`;
    }, 800);
  });
  await expect(panel.getByText('The selected job changed')).toBeVisible();
  await panel.getByRole('button', { name: /Analyze selected job/ }).click();
  await expect(
    panel.getByRole('heading', { name: 'Unarmed Security Guard – Weekends' }),
  ).toBeVisible();
  await expect(panel.getByText('Alexandria, VA 22314', { exact: true })).toBeVisible();
  await expect(panel.getByText('Sunstates Security')).toHaveCount(0);
  await expect(panel.getByText('The selected job changed')).toHaveCount(0);
});

test('reads the selected job from a details frame on another Indeed origin', async ({
  context,
  extensionId,
}) => {
  // Regression for the PaperMoon report: the details frame was on another
  // origin, the page could not read it, and v0.3.1 said "No job is open".
  // The e2e build has access to both Indeed hosts, as after "Allow reading
  // Indeed job details".
  const panel = await openPanel(context, extensionId);
  const port = process.env.FIXTURE_PORT ?? '4173';
  const key = 'e1f2a3b4c5d6e7f8';
  const job = await context.newPage();
  await job.goto(
    `http://www.indeed.com:${port}/jobs/indeed-search-papermoon.html?q=server+bartender&vjk=${key}`,
  );
  await job.evaluate(
    ([port, key]) => {
      document.querySelector<HTMLIFrameElement>('#vjs-container-iframe')!.src =
        `http://jobs.indeed.com:${port}/jobs/indeed-embedded-papermoon.html?jk=${key}&viewtype=embedded`;
    },
    [port, key],
  );
  await expect(
    job.frameLocator('#vjs-container-iframe').getByRole('heading', { name: /Server \/ Bartender/ }),
  ).toBeVisible();
  // The page itself really cannot see into the frame.
  expect(
    await job.evaluate(
      () => document.querySelector<HTMLIFrameElement>('#vjs-container-iframe')!.contentDocument,
    ),
  ).toBeNull();
  await job.bringToFront();

  await panel.getByRole('button', { name: 'Analyze this page' }).click();
  await expect(panel.getByRole('heading', { name: 'Server / Bartender' })).toBeVisible();
  await expect(panel.getByText('PaperMoon Springfield').first()).toBeVisible();
  await expect(
    panel.getByText('6315 Amherst Avenue, Springfield, VA 22150', { exact: true }),
  ).toBeVisible();
  await expect(panel.getByText('$15.54 – $17.29 per hour', { exact: true })).toBeVisible();
  await expect(panel.getByText('Part-time').first()).toBeVisible();
  await expect(panel.getByText(/Brookfield Tavern/)).toHaveCount(0);
  await expect(panel.getByText(/No job is open/)).toHaveCount(0);
  await expect(panel.getByText(/Untitled position/)).toHaveCount(0);
});

test('reads the selected job on the Indeed homepage feed', async ({ context, extensionId }) => {
  // Regression: the homepage feed has none of the search page's hooks, and
  // v0.3.1 reported "No job is open" there.
  const panel = await openPanel(context, extensionId);
  const port = process.env.FIXTURE_PORT ?? '4173';
  const job = await context.newPage();
  await job.goto(
    `http://www.indeed.com:${port}/jobs/indeed-homepage-feed.html?from=gnav-homepage--homepage-frontend&vjk=95f7e7268e283d42`,
  );
  await job.bringToFront();
  await panel.getByRole('button', { name: 'Analyze this page' }).click();
  await expect(panel.getByRole('heading', { name: 'Police Officer' })).toBeVisible();
  await expect(panel.getByText('Fairfax, VA 22035', { exact: true })).toBeVisible();
  await expect(panel.getByText('$74,034.90 – $132,956.10 per year', { exact: true })).toBeVisible();
  await expect(panel.getByText(/No job is open/)).toHaveCount(0);
  await expect(panel.getByText(/Arlington/)).toHaveCount(0);
});

test('fills location and job type from the selected feed card (CloudKitchens report)', async ({
  context,
  extensionId,
}) => {
  const panel = await openPanel(context, extensionId);
  const port = process.env.FIXTURE_PORT ?? '4173';
  const job = await context.newPage();
  await job.goto(
    `http://www.indeed.com:${port}/jobs/indeed-homepage-cloudkitchens.html?from=gnav-homepage--homepage-frontend&vjk=9a4638c51249e398`,
  );
  await job.bringToFront();
  await panel.getByRole('button', { name: 'Analyze this page' }).click();
  await expect(panel.getByRole('heading', { name: 'Facility Operations Runner' })).toBeVisible();
  await expect(panel.getByText('Alexandria, VA 22305', { exact: true })).toBeVisible();
  await expect(panel.getByText('$15 – $19 per hour', { exact: true })).toBeVisible();
  await expect(panel.getByText('Full-time').first()).toBeVisible();
  await expect(panel.getByText('Part-time', { exact: true })).toHaveCount(0);
  await expect(panel.getByText(/Chantilly|Manassas/)).toHaveCount(0);
});

test('asks for a toolbar click on pages it has no access to', async ({ context, extensionId }) => {
  const panel = await openPanel(context, extensionId);
  const blank = await context.newPage();
  await blank.goto('about:blank');
  await blank.bringToFront();
  await panel.getByRole('button', { name: 'Analyze this page' }).click();
  await expect(panel.getByRole('alert')).toContainText('Permission needed for this page');
});

for (const file of ['sample-resume.pdf', 'sample-resume.docx']) {
  test(`parses ${file} in the extension, saves it, and scores a job`, async ({
    context,
    extensionId,
  }) => {
    const panel = await openPanel(context, extensionId);
    await panel.getByRole('tab', { name: 'Profile' }).click();
    await panel.getByRole('button', { name: 'Upload a resume' }).click();
    // Real pdf.js worker / mammoth, running under the extension's CSP.
    await panel.getByLabel('Choose a file').setInputFiles(resolve(RESUMES, file));

    await expect(panel.getByRole('heading', { name: `Review ${file}` })).toBeVisible();
    await expect(panel.getByLabel('Full name')).toHaveValue('Jordan Rivera');
    await expect(panel.getByRole('region', { name: 'Experience' })).toContainText(
      'Cloud Engineering Intern',
    );
    await panel.getByRole('button', { name: 'Save to profile' }).click();
    await expect(panel.getByText('Your profile was saved from this resume.')).toBeVisible();

    // The profile survives a reload (chrome.storage.local + IndexedDB).
    await panel.reload();
    await panel.getByRole('tab', { name: 'Profile' }).click();
    await expect(panel.getByLabel('Full name')).toHaveValue('Jordan Rivera');
    await panel.getByRole('button', { name: 'Resumes' }).click();
    await expect(panel.getByRole('region', { name: 'Saved resumes' })).toContainText(file);

    const job = await context.newPage();
    await job.goto(`${FIXTURES}/jobs/json-ld-cloud-intern.html`);
    await job.bringToFront();
    await panel.getByRole('tab', { name: 'Analyze' }).click();
    await panel.getByRole('button', { name: 'Analyze this page' }).click();
    const match = panel.getByRole('region', { name: 'Match score' });
    await expect(match.getByLabel(/Match score \d+ out of 100/)).toBeVisible();
    await expect(match).toContainText('Matching qualifications');
  });
}

test('drafts a tailored resume, cover letter and screening answers through the local API', async ({
  context,
  extensionId,
}) => {
  const panel = await openPanel(context, extensionId);
  await panel.getByRole('tab', { name: 'Profile' }).click();
  await panel.getByRole('button', { name: 'Upload a resume' }).click();
  await panel.getByLabel('Choose a file').setInputFiles(resolve(RESUMES, 'sample-resume.pdf'));
  await panel.getByRole('button', { name: 'Save to profile' }).click();
  await expect(panel.getByText('Your profile was saved from this resume.')).toBeVisible();

  const job = await context.newPage();
  await job.goto(`${FIXTURES}/jobs/json-ld-cloud-intern.html`);
  await job.bringToFront();
  await panel.getByRole('tab', { name: 'Analyze' }).click();
  await panel.getByRole('button', { name: 'Analyze this page' }).click();
  await expect(panel.getByRole('heading', { name: 'Cloud Engineering Intern' })).toBeVisible();

  // Consent, then connection, are both required before anything is sent.
  await panel.getByRole('tab', { name: 'AI Tailor' }).click();
  await expect(panel.getByText('AI processing is off')).toBeVisible();
  await panel.getByRole('button', { name: 'Allow AI processing' }).click();
  await panel.getByRole('button', { name: 'Open Settings' }).click();
  await panel.getByLabel('API address').fill(API_URL);
  await panel.getByLabel('Access token').fill(API_TOKEN);
  await panel.getByRole('button', { name: 'Save and test connection' }).click();
  await expect(panel.getByText('Connected to ApplyPilot API')).toBeVisible();
  await expect(panel.getByText(/Mock mode: free drafts/)).toBeVisible();

  await panel.getByRole('tab', { name: 'AI Tailor' }).click();
  await panel.getByRole('button', { name: 'Generate tailored resume' }).click();
  await expect(panel.getByRole('heading', { name: 'Skills to feature' })).toBeVisible();
  await expect(panel.getByText(/Mock draft \(free, made offline\)/)).toBeVisible();

  await panel.getByRole('button', { name: 'Cover letter' }).click();
  await panel.getByRole('button', { name: 'Generate cover letter' }).click();
  await expect(panel.getByLabel('Cover letter (edit before you use it)')).toHaveValue(
    /^Dear Hiring Manager,[\s\S]*Jordan Rivera$/,
  );

  await panel.getByRole('button', { name: 'Questions' }).click();
  await panel
    .getByLabel('Questions')
    .fill('Describe your experience with AWS.\nAre you authorized to work in the US?');
  await expect(panel.getByText('You answer', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Draft 1 answer' }).click();
  await expect(panel.getByLabel('Draft answer (edit before you use it)')).toHaveValue(/\S/);

  // The draft survives closing the panel without another request.
  await panel.reload();
  await job.bringToFront();
  // The Analyze tab restores this tab's cached analysis.
  await expect(panel.getByRole('heading', { name: 'Cloud Engineering Intern' })).toBeVisible();
  await panel.getByRole('tab', { name: 'AI Tailor' }).click();
  await expect(panel.getByRole('heading', { name: 'Skills to feature' })).toBeVisible();
  await expect(panel.getByText(/· saved /)).toBeVisible();

  // The job page itself was never touched.
  await expect(job.locator('h1')).toHaveText('Cloud Engineering Intern');
});

// ---- Phase 4: autofill ---------------------------------------------------------

async function saveResumeProfile(panel: Page) {
  await panel.getByRole('tab', { name: 'Profile' }).click();
  await panel.getByRole('button', { name: 'Upload a resume' }).click();
  await panel.getByLabel('Choose a file').setInputFiles(resolve(RESUMES, 'sample-resume.pdf'));
  await panel.getByRole('button', { name: 'Save to profile' }).click();
  await expect(panel.getByText('Your profile was saved from this resume.')).toBeVisible();
}

async function openForm(context: BrowserContext, host: string, file: string): Promise<Page> {
  const port = process.env.FIXTURE_PORT ?? '4173';
  const page = await context.newPage();
  await page.goto(`http://${host}:${port}/applications/${file}`);
  await page.bringToFront();
  return page;
}

async function scanForm(panel: Page) {
  await panel.getByRole('tab', { name: 'Autofill' }).click();
  const scan = panel.getByRole('button', { name: /^Scan (this form|again)$/ });
  await scan.click();
}

const pageCounter = (page: Page, name: 'submitCount' | 'stepChanges') =>
  page.evaluate((key) => (window as unknown as Record<string, number>)[key], name);

test('autofill: reviews and fills a plain application form, attaches the resume, never submits', async ({
  context,
  extensionId,
}) => {
  const panel = await openPanel(context, extensionId);
  await saveResumeProfile(panel);
  const form = await openForm(context, '127.0.0.1', 'generic-application.html');
  await scanForm(panel);

  await expect(panel.getByText('Apply for Cloud Engineering Intern')).toBeVisible();
  const ready = panel.getByRole('region', { name: 'Ready to fill' });
  await expect(ready.getByLabel('Value for Email')).toHaveValue('jordan.rivera@example.com');
  await expect(ready.getByText('Attaches sample-resume.pdf')).toBeVisible();
  const manual = panel.getByRole('region', { name: 'You answer these on the page' });
  await expect(manual.getByText('Gender', { exact: true })).toBeVisible();
  await expect(manual.getByRole('checkbox')).toHaveCount(0);

  await panel.getByRole('button', { name: /^Fill \d+ approved fields$/ }).click();
  await expect(panel.getByRole('status', { name: 'Fill results' })).toContainText('filled');

  await expect(form.locator('#first')).toHaveValue('Jordan');
  await expect(form.locator('#email')).toHaveValue('jordan.rivera@example.com');
  expect(
    await form.evaluate(
      () => (document.querySelector('input[type="file"]') as HTMLInputElement).files?.[0]?.name,
    ),
  ).toBe('sample-resume.pdf');
  // Sensitive answers and the submit button are untouched.
  await expect(form.locator('select[name="gender"]')).toHaveValue('');
  await expect(form.locator('input[name="work_auth"]:checked')).toHaveCount(0);
  await expect(form.locator('#password')).toHaveValue('');
  expect(await pageCounter(form, 'submitCount')).toBe(0);
});

test('autofill: fills one step of a multi-step Workday-style form at a time', async ({
  context,
  extensionId,
}) => {
  const panel = await openPanel(context, extensionId);
  await saveResumeProfile(panel);
  const form = await openForm(context, 'acme.wd5.myworkdayjobs.com', 'workday-application.html');
  await scanForm(panel);
  await expect(panel.getByText('Workday', { exact: true })).toBeVisible();
  await expect(panel.getByText('Step 1 of 4')).toBeVisible();
  await expect(panel.getByText('More steps may follow')).toBeVisible();

  await panel.getByRole('button', { name: /^Fill \d+ approved fields?$/ }).click();
  await expect(panel.getByRole('status', { name: 'Fill results' })).toBeVisible();
  await expect(form.locator('#fn')).toHaveValue('Jordan');
  expect(await pageCounter(form, 'stepChanges')).toBe(0);

  // The user moves to the next step; ApplyPilot scans it fresh.
  await form.bringToFront();
  await form.getByRole('button', { name: 'Save and Continue' }).click();
  await scanForm(panel);
  await expect(panel.getByText('Step 2 of 4')).toBeVisible();
  await panel.getByRole('button', { name: /^Fill \d+ approved fields?$/ }).click();
  await expect(panel.getByRole('status', { name: 'Fill results' })).toBeVisible();
  await expect(form.locator('#t1')).toHaveValue('Cloud Engineering Intern');
  await expect(form.locator('#c1')).toHaveValue('Northwind Logistics');
  await expect(form.locator('#t2')).toHaveValue('IT Support Assistant');
  await expect(form.locator('#school')).toHaveValue('University of Toronto');
  expect(await pageCounter(form, 'stepChanges')).toBe(1);
  expect(await pageCounter(form, 'submitCount')).toBe(0);
});

test('autofill: handles react-select style typeaheads and web components', async ({
  context,
  extensionId,
}) => {
  const panel = await openPanel(context, extensionId);
  await saveResumeProfile(panel);

  const greenhouse = await openForm(
    context,
    'job-boards.greenhouse.io',
    'greenhouse-application.html',
  );
  await scanForm(panel);
  await expect(panel.getByText('Greenhouse', { exact: true })).toBeVisible();
  const review = panel.getByRole('region', { name: 'Check these' });
  // Typeahead choices start unselected; the user opts in.
  await review.getByRole('checkbox', { name: 'Fill Degree' }).check();
  // The sample school list has no "University of Toronto": it is reported, not guessed.
  await review.getByRole('checkbox', { name: 'Fill School' }).check();
  await panel.getByRole('button', { name: /^Fill \d+ approved fields$/ }).click();
  await expect(panel.getByRole('status', { name: 'Fill results' })).toBeVisible();
  await expect(greenhouse.locator('#first_name')).toHaveValue('Jordan');
  await expect(greenhouse.locator('#degree--0')).toHaveAttribute(
    'data-selected',
    "Bachelor's Degree",
  );
  await expect(greenhouse.locator('#school--0')).not.toHaveAttribute('data-selected');
  await expect(panel.getByRole('status', { name: 'Fill results' })).toContainText(
    'No option matching "University of Toronto" appeared',
  );
  await expect(greenhouse.locator('#gender')).not.toHaveAttribute('data-selected');
  expect(await pageCounter(greenhouse, 'submitCount')).toBe(0);

  const smart = await openForm(
    context,
    'jobs.smartrecruiters.com',
    'smartrecruiters-application.html',
  );
  await scanForm(panel);
  await expect(panel.getByText('SmartRecruiters', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: /^Fill \d+ approved fields$/ }).click();
  await expect(panel.getByRole('status', { name: 'Fill results' })).toBeVisible();
  expect(
    await smart.evaluate(
      () =>
        [...document.querySelectorAll('sr-input')]
          .map((h) => h.shadowRoot?.querySelector('input'))
          .find((i) => i?.name === 'firstName')?.value,
    ),
  ).toBe('Jordan');
  expect(await pageCounter(smart, 'stepChanges')).toBe(0);
});

test('autofill: the downloadable practice form fills and locks the right fields, never submits', async ({
  context,
  extensionId,
}) => {
  const panel = await openPanel(context, extensionId);
  await saveResumeProfile(panel);
  const form = await openForm(context, '127.0.0.1', 'practice-application.html');
  await scanForm(panel);

  await expect(panel.getByText('Apply for Cloud Support Intern')).toBeVisible();
  const manual = panel.getByRole('region', { name: 'You answer these on the page' });
  for (const label of [
    'Are you legally authorized to work in the United States? *',
    'Will you now or in the future require visa sponsorship?',
    'Desired hourly pay',
    'Gender',
    'Disability status',
  ]) {
    await expect(manual.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(manual.getByRole('checkbox')).toHaveCount(0);
  await expect(panel.getByRole('region', { name: 'Open questions' })).toContainText(
    'Why are you interested in this internship?',
  );

  await panel.getByRole('button', { name: /^Fill \d+ approved fields$/ }).click();
  await expect(panel.getByRole('status', { name: 'Fill results' })).toContainText('0 failed');

  await expect(form.locator('#email')).toHaveValue('jordan.rivera@example.com');
  await expect(form.locator('#github')).toHaveValue('https://github.com/jrivera-dev');
  await expect(form.locator('#school')).toHaveValue('University of Toronto');
  await expect(form.locator('#job1_company')).toHaveValue('Northwind Logistics');
  await expect(form.locator('#job2_title')).toHaveValue('IT Support Assistant');
  await expect(form.locator('input[name="work_auth"]:checked')).toHaveCount(0);
  await expect(form.locator('#gender')).toHaveValue('');
  await expect(form.locator('#q_salary')).toHaveValue('');
  await expect(form.locator('#certify')).not.toBeChecked();
  await expect(form.locator('#attempts')).toHaveText('0');
  expect(await pageCounter(form, 'submitCount')).toBe(0);
});
