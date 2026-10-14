import { resolve } from 'node:path';
import { test as base, chromium, expect, type BrowserContext, type Page } from '@playwright/test';

/**
 * Loads the e2e build (apps/extension/dist-e2e) into real Chromium. The e2e
 * build differs from release only by host access to http://127.0.0.1, which
 * stands in for the user's toolbar click (activeTab) that automation cannot do.
 */
const EXTENSION_PATH = resolve(import.meta.dirname, '../../apps/extension/dist-e2e');
const FIXTURES = `http://127.0.0.1:${process.env.FIXTURE_PORT ?? 4173}`;

const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
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
  expect(reply).toEqual({ ok: true, data: { version: '0.1.0' } });
  const rejected = await panel.evaluate((): Promise<unknown> =>
    chrome.runtime.sendMessage({ type: 'job/submit' }),
  );
  expect(rejected).toMatchObject({ ok: false, error: { code: 'INVALID_MESSAGE' } });
});

test('side panel renders and navigates', async ({ context, extensionId }) => {
  const panel = await openPanel(context, extensionId);
  await expect(panel.getByRole('tab')).toHaveCount(6);
  await panel.getByRole('tab', { name: 'Resume' }).click();
  await expect(panel.getByRole('tabpanel')).toContainText('Not built yet');
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

test('asks for a toolbar click on pages it has no access to', async ({ context, extensionId }) => {
  const panel = await openPanel(context, extensionId);
  const blank = await context.newPage();
  await blank.goto('about:blank');
  await blank.bringToFront();
  await panel.getByRole('button', { name: 'Analyze this page' }).click();
  await expect(panel.getByRole('alert')).toContainText('Permission needed for this page');
});
