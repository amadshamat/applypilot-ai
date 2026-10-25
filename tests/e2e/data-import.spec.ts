import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * Import data and Delete all local data in real Chromium, with Chrome
 * profiles on disk so a browser restart can be checked.
 */
const EXTENSION_PATH = resolve(import.meta.dirname, '../../apps/extension/dist-e2e');
const FIXTURES = `http://127.0.0.1:${process.env.FIXTURE_PORT ?? 4173}`;
const RESUMES = resolve(import.meta.dirname, '../fixtures/resumes');

const dirs: string[] = [];
test.afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

async function newProfileDir() {
  const dir = await mkdtemp(join(tmpdir(), 'applypilot-e2e-'));
  dirs.push(dir);
  return dir;
}

async function launch(
  userDataDir: string,
): Promise<{ context: BrowserContext; extensionId: string }> {
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    acceptDownloads: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  return { context, extensionId: new URL(worker.url()).host };
}

async function openPanel(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  return page;
}

async function analyzeAndTrack(context: BrowserContext, panel: Page) {
  const job = await context.newPage();
  await job.goto(`${FIXTURES}/jobs/json-ld-cloud-intern.html`);
  await job.bringToFront();
  await panel.getByRole('tab', { name: 'Analyze' }).click();
  await panel.getByRole('button', { name: 'Analyze this page' }).click();
  const tracker = panel.getByLabel('Application tracker');
  await tracker.getByRole('button', { name: 'Save to tracker' }).click();
  await expect(tracker).toContainText('In your tracker');
  return job;
}

async function saveResumeProfile(panel: Page) {
  await panel.getByRole('tab', { name: 'Profile' }).click();
  await panel.getByRole('button', { name: 'Upload a resume' }).click();
  await panel.getByLabel('Choose a file').setInputFiles(resolve(RESUMES, 'sample-resume.pdf'));
  await panel.getByRole('button', { name: 'Save to profile' }).click();
  await expect(panel.getByText('Your profile was saved from this resume.')).toBeVisible();
}

/** Switches the panel to another tab and back, which re-reads the cached analysis of the active tab. */
async function showAnalyzeTab(panel: Page) {
  await panel.getByRole('tab', { name: 'Settings' }).click();
  await panel.getByRole('tab', { name: 'Analyze' }).click();
}

async function expectRestored(panel: Page) {
  await panel.getByRole('tab', { name: 'Applications' }).click();
  await expect(
    panel.getByRole('article', { name: 'Cloud Engineering Intern at Northwind Cloud' }),
  ).toBeVisible();
  await panel.getByRole('tab', { name: 'Profile' }).click();
  await expect(panel.getByLabel('Full name')).toHaveValue('Jordan Rivera');
  await panel.getByRole('button', { name: 'Resumes' }).click();
  await expect(panel.getByRole('region', { name: 'Saved resumes' })).toContainText(
    'sample-resume.pdf',
  );
}

test('export and import round trip: populated and empty profiles, kept after a restart', async () => {
  test.setTimeout(90_000);
  // A Chrome profile with a resume, a profile and a tracked job.
  const source = await launch(await newProfileDir());
  const panel = await openPanel(source.context, source.extensionId);
  await saveResumeProfile(panel);
  await analyzeAndTrack(source.context, panel);
  await panel.bringToFront();
  await panel.getByRole('tab', { name: 'Settings' }).click();
  const download = panel.waitForEvent('download');
  await panel.getByRole('button', { name: 'Export data' }).click();
  const exported = await download;
  expect(exported.suggestedFilename()).toMatch(/^applypilot-export-\d{4}-\d{2}-\d{2}\.json$/);
  const backupPath = join(await newProfileDir(), 'backup.json');
  await exported.saveAs(backupPath);
  const text = await readFile(backupPath, 'utf8');
  expect(text).toContain('"format": "applypilot-backup"');
  expect(text).toContain('"base64"');

  // Importing into the same, populated profile changes nothing.
  await panel.getByLabel('Backup file to import').setInputFiles(backupPath);
  const samePreview = panel.getByLabel('Import preview');
  await expect(samePreview).toContainText('Nothing would change');
  await expect(samePreview.getByRole('button', { name: 'Import and merge' })).toBeDisabled();
  await samePreview.getByRole('button', { name: 'Cancel' }).click();
  await source.context.close();

  // A new, empty Chrome profile.
  const targetDir = await newProfileDir();
  let target = await launch(targetDir);
  let restored = await openPanel(target.context, target.extensionId);
  await restored.getByRole('tab', { name: 'Settings' }).click();
  await restored.getByLabel('Backup file to import').setInputFiles(backupPath);
  const preview = restored.getByLabel('Import preview');
  await expect(preview).toContainText('Your profile, 1 tracked application');
  await expect(preview).toContainText('1 resume file');
  await preview.getByRole('button', { name: 'Import and merge' }).click();
  await expect(restored.getByText('Import finished')).toBeVisible();
  await expectRestored(restored);

  // Restart Chrome on the same profile: everything is still there.
  await target.context.close();
  target = await launch(targetDir);
  restored = await openPanel(target.context, target.extensionId);
  await expectRestored(restored);
  // The restored resume is the original file.
  const resumeDownload = restored.waitForEvent('download');
  await restored.getByRole('button', { name: /Download sample-resume\.pdf/ }).click();
  const resumeFile = await readFile(await (await resumeDownload).path());
  expect(resumeFile.equals(await readFile(resolve(RESUMES, 'sample-resume.pdf')))).toBe(true);
  await target.context.close();
});

test('Delete all local data drops cached analyses in every open page', async () => {
  const { context, extensionId } = await launch(await newProfileDir());
  const panel = await openPanel(context, extensionId);
  const job = await analyzeAndTrack(context, panel);
  const cachedKeys = () =>
    panel.evaluate(async () =>
      Object.keys(await chrome.storage.session.get(null)).filter((k) =>
        k.startsWith('job-analysis:'),
      ),
    );
  expect(await cachedKeys()).toHaveLength(1);

  // A second panel shows the cached analysis of the job tab.
  const second = await openPanel(context, extensionId);
  await job.bringToFront();
  await showAnalyzeTab(second);
  await expect(second.getByText('Showing the earlier analysis of this tab.')).toBeVisible();

  // Delete everything from the options page.
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByRole('button', { name: /Delete all local data/ }).click();
  await options.getByRole('button', { name: 'Yes, delete everything' }).click();
  await expect(options.getByText(/along with the cached page analyses/)).toBeVisible();
  expect(await cachedKeys()).toEqual([]);

  // The open panels drop what they showed, also after switching tabs.
  await job.bringToFront();
  for (const page of [panel, second]) {
    await showAnalyzeTab(page);
    await expect(page.getByRole('button', { name: 'Analyze this page' })).toBeVisible();
    await expect(page.getByText('Cloud Engineering Intern')).toHaveCount(0);
  }
  // A panel opened afterwards finds nothing either.
  const reopened = await openPanel(context, extensionId);
  await job.bringToFront();
  await showAnalyzeTab(reopened);
  await expect(reopened.getByRole('button', { name: 'Analyze this page' })).toBeVisible();
  await expect(reopened.getByText('Showing the earlier analysis of this tab.')).toHaveCount(0);
  await reopened.getByRole('tab', { name: 'Applications' }).click();
  await expect(reopened.getByRole('tabpanel')).toContainText('Nothing tracked yet');
  await context.close();
});
