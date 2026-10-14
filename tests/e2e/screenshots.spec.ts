import { resolve } from 'node:path';
import { chromium, test } from '@playwright/test';

/** Captures README screenshots. Run with: SCREENSHOTS=1 pnpm test:e2e */
test.skip(!process.env.SCREENSHOTS, 'Set SCREENSHOTS=1 to capture documentation screenshots');

const EXTENSION_PATH = resolve(import.meta.dirname, '../../apps/extension/dist-e2e');
const OUT = resolve(import.meta.dirname, '../../docs/screenshots');
const FIXTURES = `http://127.0.0.1:${process.env.FIXTURE_PORT ?? 4173}`;

test('capture side panel screenshots', async () => {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    viewport: { width: 400, height: 900 },
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await panel.screenshot({ path: `${OUT}/sidepanel-empty.png` });

  const job = await context.newPage();
  await job.goto(`${FIXTURES}/jobs/greenhouse-software-intern.html`);
  await job.bringToFront();
  await panel.getByRole('button', { name: 'Analyze this page' }).click();
  await panel.getByRole('heading', { level: 2 }).first().waitFor();
  await panel.screenshot({ path: `${OUT}/sidepanel-analysis-light.png`, fullPage: true });

  await panel.emulateMedia({ colorScheme: 'dark' });
  await panel.screenshot({ path: `${OUT}/sidepanel-analysis-dark.png` });

  await panel.emulateMedia({ colorScheme: 'light' });
  await panel.getByRole('tab', { name: 'Settings' }).click();
  await panel.getByLabel('Theme').waitFor();
  await panel.screenshot({ path: `${OUT}/sidepanel-settings.png`, fullPage: true });

  // Phase 2: resume review, profile and match.
  await panel.getByRole('tab', { name: 'Profile' }).click();
  await panel.screenshot({ path: `${OUT}/profile-empty.png` });
  await panel.getByRole('button', { name: 'Upload a resume' }).click();
  await panel
    .getByLabel('Choose a file')
    .setInputFiles(resolve(import.meta.dirname, '../fixtures/resumes/sample-resume.pdf'));
  await panel.getByRole('heading', { name: /^Review/ }).waitFor();
  await panel.screenshot({ path: `${OUT}/resume-review.png`, fullPage: true });
  await panel.getByRole('button', { name: 'Save to profile' }).click();
  await panel.getByText('Your profile was saved from this resume.').waitFor();
  await panel.getByRole('button', { name: 'Edit Cloud Engineering Intern' }).click();
  await panel.screenshot({ path: `${OUT}/profile-editor.png`, fullPage: true });

  const cloudJob = await context.newPage();
  await cloudJob.goto(`${FIXTURES}/jobs/json-ld-cloud-intern.html`);
  await cloudJob.bringToFront();
  await panel.getByRole('tab', { name: 'Analyze' }).click();
  await panel.getByRole('button', { name: /Analyze this page|Re-analyze/ }).click();
  await panel.getByLabel(/Match score \d+ out of 100/).waitFor();
  await panel
    .getByRole('region', { name: 'Match score' })
    .screenshot({ path: `${OUT}/match-light.png` });
  await panel.emulateMedia({ colorScheme: 'dark' });
  await panel
    .getByRole('region', { name: 'Match score' })
    .screenshot({ path: `${OUT}/match-dark.png` });

  // Phase 3: AI drafts through the local API in mock mode (started by playwright.config.ts).
  await panel.emulateMedia({ colorScheme: 'light' });
  await panel.getByRole('tab', { name: 'AI Tailor' }).click();
  await panel.getByRole('button', { name: 'Allow AI processing' }).click();
  await panel.getByRole('button', { name: 'Open Settings' }).click();
  await panel
    .getByLabel('API address')
    .fill(`http://127.0.0.1:${process.env.E2E_API_PORT ?? 8799}`);
  await panel.getByLabel('Access token').fill('e2e-local-token-0123456789abcdef');
  await panel.getByRole('button', { name: 'Save and test connection' }).click();
  await panel.getByText('Connected to ApplyPilot API').waitFor();
  await panel.screenshot({ path: `${OUT}/ai-connection.png`, fullPage: true });
  await panel.getByRole('tab', { name: 'AI Tailor' }).click();
  await panel.getByText('What will be sent').click();
  await panel.screenshot({ path: `${OUT}/ai-preview.png`, fullPage: true });
  await panel.getByRole('button', { name: 'Generate tailored resume' }).click();
  await panel.getByText('Skills to feature').waitFor();
  await panel.screenshot({ path: `${OUT}/ai-tailored-resume.png`, fullPage: true });
  await panel.getByRole('button', { name: 'Questions' }).click();
  await panel
    .getByLabel('Questions')
    .fill('Why do you want this internship?\nDo you require visa sponsorship?');
  await panel.getByRole('button', { name: 'Draft 1 answer' }).click();
  await panel.getByLabel('Draft answer (edit before you use it)').waitFor();
  await panel.screenshot({ path: `${OUT}/ai-screening.png`, fullPage: true });
  await context.close();
});
