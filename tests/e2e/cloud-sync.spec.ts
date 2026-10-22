import { resolve } from 'node:path';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * Cloud sync between two browsers, end to end: real Chromium windows, the
 * real extension build, the real sign-in flow (chrome.identity) and the real
 * cloud API code, with local stand-ins for Cognito and DynamoDB
 * (pnpm cloud:local). Nothing reaches AWS.
 */
const EXTENSION_PATH = resolve(import.meta.dirname, '../../apps/extension/dist-e2e');
const PASSWORD = 'correct horse battery staple';

async function browser(): Promise<{ context: BrowserContext; panel: Page }> {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${new URL(worker.url()).host}/sidepanel.html`);
  return { context, panel };
}

async function signIn(
  { context, panel }: { context: BrowserContext; panel: Page },
  email: string,
  mode: 'Sign in' | 'Create account',
) {
  await panel.getByRole('tab', { name: 'Settings' }).click();
  const card = panel.locator('div.rounded-xl', { hasText: 'Cloud sync (optional)' });
  await card.getByRole('button', { name: 'Use local test server' }).click();
  const popup = context.waitForEvent('page');
  await card.getByRole('button', { name: 'Sign in or create account' }).click();
  const signInPage = await popup;
  await signInPage.getByLabel('Email').fill(email);
  await signInPage.getByLabel(/Password/).fill(PASSWORD);
  await signInPage.getByRole('button', { name: mode, exact: true }).click();
  await expect(card.getByText(email)).toBeVisible();
  await card.getByRole('switch', { name: 'Sync profile and tracker' }).click();
  await expect(card.getByText('Up to date.')).toBeVisible();
  return card;
}

async function addApplication(panel: Page, title: string) {
  await panel.getByRole('tab', { name: 'Applications' }).click();
  await panel.getByRole('button', { name: /^Add$/ }).click();
  const form = panel.getByRole('form', { name: 'Add an application' });
  await form.getByLabel('Job title').fill(title);
  await form.getByLabel('Company').fill('Northwind Cloud');
  await form.getByRole('button', { name: 'Add' }).click();
  await expect(panel.getByRole('article', { name: `${title} at Northwind Cloud` })).toBeVisible();
}

test('syncs the tracker between two browsers through the local cloud', async () => {
  test.setTimeout(90_000);
  const email = `e2e-${Date.now()}@example.com`;
  const a = await browser();
  const b = await browser();
  try {
    await addApplication(a.panel, 'Cloud Support Intern');
    const cardA = await signIn(a, email, 'Create account');
    // B has its own record before signing in: both survive the first sync.
    await addApplication(b.panel, 'DevOps Intern');
    await signIn(b, email, 'Sign in');

    await b.panel.getByRole('tab', { name: 'Applications' }).click();
    await expect(
      b.panel.getByRole('article', { name: 'Cloud Support Intern at Northwind Cloud' }),
    ).toBeVisible();

    await a.panel.getByRole('tab', { name: 'Settings' }).click();
    await cardA.getByRole('button', { name: 'Sync now' }).click();
    await a.panel.getByRole('tab', { name: 'Applications' }).click();
    await expect(
      a.panel.getByRole('article', { name: 'DevOps Intern at Northwind Cloud' }),
    ).toBeVisible();

    // Deleting cloud data keeps local data and turns sync off.
    await a.panel.getByRole('tab', { name: 'Settings' }).click();
    await cardA.getByRole('button', { name: 'Delete cloud data' }).click();
    await cardA.getByRole('button', { name: 'Yes, delete cloud data' }).click();
    await expect(cardA.getByText(/Your cloud data was deleted and sync is off/)).toBeVisible();
    await a.panel.getByRole('tab', { name: 'Applications' }).click();
    await expect(
      a.panel.getByRole('article', { name: 'DevOps Intern at Northwind Cloud' }),
    ).toBeVisible();

    // B notices the reset and uploads nothing until the user decides.
    await b.panel.getByRole('tab', { name: 'Settings' }).click();
    const cardB = b.panel.locator('div.rounded-xl', { hasText: 'Cloud sync (optional)' });
    await cardB.getByRole('button', { name: 'Sync now' }).click();
    await expect(cardB.getByText('Your cloud data was deleted elsewhere')).toBeVisible();

    // Signing out ends the sign-in page's session too: signing in again asks for the password.
    await a.panel.getByRole('tab', { name: 'Settings' }).click();
    await cardA.getByRole('button', { name: 'Sign out' }).click();
    const popup = a.context.waitForEvent('page');
    await cardA.getByRole('button', { name: 'Sign in or create account' }).click();
    const again = await popup;
    await expect(again.getByLabel(/Password/)).toBeVisible();
    await again.close();
  } finally {
    await a.context.close();
    await b.context.close();
  }
});
