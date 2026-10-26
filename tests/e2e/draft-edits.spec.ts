import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * Edited AI drafts in real Chromium: autosave, closing the panel straight
 * after typing, a Chrome restart, revert, and generating over edits. Drafts
 * come from the local API in mock mode (free, offline).
 */
const EXTENSION_PATH = resolve(import.meta.dirname, '../../apps/extension/dist-e2e');
const FIXTURES = `http://127.0.0.1:${process.env.FIXTURE_PORT ?? 4173}`;
const RESUMES = resolve(import.meta.dirname, '../fixtures/resumes');
const API_URL = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 8799}`;
const API_TOKEN = 'e2e-local-token-0123456789abcdef';
const JOB = `${FIXTURES}/jobs/json-ld-cloud-intern.html`;
const LETTER = 'Cover letter (edit before you use it)';

test.use({ actionTimeout: 10_000 });

let userDataDir = '';
test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'applypilot-drafts-'));
});
test.afterAll(async () => {
  await rm(userDataDir, { recursive: true, force: true });
});

async function launch(): Promise<{ context: BrowserContext; extensionId: string }> {
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  return { context, extensionId: new URL(worker.url()).host };
}

async function openPanel(context: BrowserContext, extensionId: string) {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  return panel;
}

/** Opens the job, analyzes it and shows the cover letter tool. */
async function openCoverLetter(context: BrowserContext, panel: Page) {
  const job = await context.newPage();
  await job.goto(JOB);
  await job.bringToFront();
  await panel.getByRole('tab', { name: 'Analyze' }).click();
  await panel.getByRole('button', { name: /Analyze this page|Re-analyze/ }).click();
  await expect(panel.getByRole('heading', { name: 'Cloud Engineering Intern' })).toBeVisible();
  await panel.getByRole('tab', { name: 'AI Tailor' }).click();
  await panel.getByRole('button', { name: 'Cover letter' }).click();
}

test('edited drafts survive closing the panel, reloading and restarting Chrome', async () => {
  test.setTimeout(90_000);
  let { context, extensionId } = await launch();
  let panel = await openPanel(context, extensionId);

  // Profile, consent and the local API connection.
  await panel.getByRole('tab', { name: 'Profile' }).click();
  await panel.getByRole('button', { name: 'Upload a resume' }).click();
  await panel.getByLabel('Choose a file').setInputFiles(resolve(RESUMES, 'sample-resume.pdf'));
  await panel.getByRole('button', { name: 'Save to profile' }).click();
  await expect(panel.getByText('Your profile was saved from this resume.')).toBeVisible();
  await panel.getByRole('tab', { name: 'AI Tailor' }).click();
  await panel.getByRole('button', { name: 'Allow AI processing' }).click();
  await panel.getByRole('button', { name: 'Open Settings' }).click();
  await panel.getByLabel('API address').fill(API_URL);
  await panel.getByLabel('Access token').fill(API_TOKEN);
  await panel.getByRole('button', { name: 'Save and test connection' }).click();
  await expect(panel.getByText('Connected to ApplyPilot API')).toBeVisible();

  await openCoverLetter(context, panel);
  await panel.getByRole('button', { name: 'Generate cover letter' }).click();
  const letter = panel.getByLabel(LETTER);
  await expect(letter).toHaveValue(/^Dear Hiring Manager,/);
  const generated = await letter.inputValue();

  await letter.press('Control+End');
  await letter.pressSequentially(' I would love to talk.');
  await expect(panel.getByText('All changes saved')).toBeVisible();
  const edited = `${generated} I would love to talk.`;

  // Reload the panel: the edit is there, with the generated text kept beside it.
  await panel.reload();
  await openCoverLetter(context, panel);
  await expect(panel.getByLabel(LETTER)).toHaveValue(edited);
  await expect(panel.getByText(/Edited ·/)).toBeVisible();

  // Type and close the panel at once, before the save delay passes.
  await panel.getByLabel(LETTER).press('Control+End');
  await panel.getByLabel(LETTER).pressSequentially(' Thanks!');
  await panel.close();
  panel = await openPanel(context, extensionId);
  await openCoverLetter(context, panel);
  await expect(panel.getByLabel(LETTER)).toHaveValue(`${edited} Thanks!`);

  // Restart Chrome on the same profile.
  await context.close();
  ({ context, extensionId } = await launch());
  panel = await openPanel(context, extensionId);
  await openCoverLetter(context, panel);
  await expect(panel.getByLabel(LETTER)).toHaveValue(`${edited} Thanks!`);

  // Generating again asks first, and the edited version can be restored.
  await panel.getByRole('button', { name: 'Generate again' }).click();
  await panel.getByRole('button', { name: 'Generate a new draft' }).click();
  await expect(panel.getByText('Your edited version is kept')).toBeVisible();
  await expect(panel.getByLabel(LETTER)).toHaveValue(/^Dear Hiring Manager,[\s\S]*Jordan Rivera$/);
  await panel.getByRole('button', { name: /Restore my edited version/ }).click();
  await expect(panel.getByLabel(LETTER)).toHaveValue(`${edited} Thanks!`);

  // Autofill offers the edited letter for a cover-letter field.
  const form = await context.newPage();
  await form.goto(`${FIXTURES}/applications/generic-application.html`);
  await form.bringToFront();
  await panel.getByRole('tab', { name: 'Autofill' }).click();
  await panel.getByRole('button', { name: /^Scan (this form|again)$/ }).click();
  await expect
    .poll(() =>
      panel.evaluate(
        () =>
          [...document.querySelectorAll('textarea, input')].some((el) =>
            (el as HTMLTextAreaElement).value.endsWith('I would love to talk. Thanks!'),
          ) || document.body.innerText.includes('I would love to talk. Thanks!'),
      ),
    )
    .toBe(true);
  await form.close();
  await openCoverLetter(context, panel);

  // Revert to the generated text, after confirming; it stays reverted after a reload.
  await panel.getByRole('button', { name: /Revert to generated text/ }).click();
  await panel.getByRole('button', { name: 'Yes, discard my edits' }).click();
  await expect(panel.getByLabel(LETTER)).toHaveValue(generated);
  await expect(panel.getByText('All changes saved')).toBeVisible();
  await panel.reload();
  await openCoverLetter(context, panel);
  await expect(panel.getByLabel(LETTER)).toHaveValue(generated);
  await expect(panel.getByRole('button', { name: /Revert to generated text/ })).toHaveCount(0);
  await context.close();
});
