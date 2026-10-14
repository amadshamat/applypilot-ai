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

const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        // Serve the Indeed fixture under Indeed's hostname so the adapter matches.
        '--host-resolver-rules=MAP www.indeed.com 127.0.0.1',
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
  expect(reply).toEqual({ ok: true, data: { version: '0.3.0' } });
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
  await expect(panel.getByText('Skills to feature')).toBeVisible();
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
  await expect(panel.getByText('Skills to feature')).toBeVisible();
  await expect(panel.getByText(/· saved /)).toBeVisible();

  // The job page itself was never touched.
  await expect(job.locator('h1')).toHaveText('Cloud Engineering Intern');
});
