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
  await context.close();
});
