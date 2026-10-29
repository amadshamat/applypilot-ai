import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';

/**
 * Records the README demo: the extension driven end to end with fictional data
 * and the local API in free mock mode. Frames from the job page and the side
 * panel are captured through the Chrome DevTools screencast, with a timeline
 * of captions; scripts/demo/render-demo.mjs turns them into an MP4.
 * Run with: pnpm demo:video
 */
test.skip(!process.env.DEMO_VIDEO, 'Set DEMO_VIDEO=1 to record the demo video');

const EXTENSION_PATH = resolve(import.meta.dirname, '../../apps/extension/dist-e2e');
const OUT = resolve(import.meta.dirname, '../../demo-output');
const FIXTURES = `http://127.0.0.1:${process.env.FIXTURE_PORT ?? 4173}`;
const API_URL = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 8799}`;
const API_TOKEN = 'e2e-local-token-0123456789abcdef';
const RESUME = resolve(import.meta.dirname, '../fixtures/resumes/sample-resume.pdf');

/** Page sizes in the final video: the browser on the left, the side panel on the right. */
const LEFT = { width: 860, height: 640 };
const PANEL = { width: 420, height: 640 };

interface Frame {
  file: string;
  t: number;
}

const frames: Record<'left' | 'panel', Frame[]> = { left: [], panel: [] };
const captions: { t: number; text: string }[] = [];

async function record(context: BrowserContext, page: Page, name: 'left' | 'panel') {
  const dir = resolve(OUT, 'frames', name);
  mkdirSync(dir, { recursive: true });
  const cdp = await context.newCDPSession(page);
  cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
    const file = `frames/${name}/${String(frames[name].length).padStart(6, '0')}.jpg`;
    writeFileSync(resolve(OUT, file), Buffer.from(data, 'base64'));
    frames[name].push({ file, t: Date.now() });
    void cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined);
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90 });
  return () => cdp.send('Page.stopScreencast').catch(() => undefined);
}

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function caption(text: string, hold = 0) {
  captions.push({ t: Date.now(), text });
  console.log(`[demo] ${text.split('\n')[0]}`);
  if (hold) await pause(hold);
}

/** Outlines what is about to be clicked, so a viewer can follow along. */
async function show(target: Locator, ms = 700) {
  await target.scrollIntoViewIfNeeded();
  await target.evaluate((el: HTMLElement) => {
    const before = el.style.outline;
    el.style.outline = '3px solid #f59e0b';
    el.style.outlineOffset = '2px';
    setTimeout(() => (el.style.outline = before), 1200);
  });
  await pause(ms);
}

async function click(target: Locator, after = 900) {
  await show(target);
  await target.click();
  await pause(after);
}

async function scroll(page: Page, by: number, steps = 12) {
  // The middle of the narrower panel, which is inside the job page as well.
  await page.mouse.move(PANEL.width / 2, PANEL.height / 2);
  for (let i = 0; i < steps; i += 1) {
    await page.mouse.wheel(0, by / steps);
    await pause(50);
  }
  await pause(500);
}

test('record the demo video', async () => {
  test.setTimeout(420_000);
  rmSync(OUT, { recursive: true, force: true });
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    viewport: LEFT,
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;

  const left = await context.newPage();
  for (const page of context.pages()) if (page !== left) await page.close();
  await left.goto(`${FIXTURES}/jobs/json-ld-cloud-intern.html`);
  const panel = await context.newPage();
  // Sized through DevTools: setViewportSize would also shrink what the job page's
  // screencast captures, as both tabs share one window.
  await (
    await context.newCDPSession(panel)
  ).send('Emulation.setDeviceMetricsOverride', { ...PANEL, deviceScaleFactor: 1, mobile: false });
  for (const page of [left, panel]) page.setDefaultTimeout(20_000);
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await left.bringToFront();
  await pause(800);

  const start = Date.now();
  const stops = [await record(context, left, 'left'), await record(context, panel, 'panel')];
  await pause(500);

  // ---- Overview ----------------------------------------------------------------
  await caption(
    'ApplyPilot AI runs in Chrome’s side panel (right) next to the page you are viewing (left).\nThis demo uses fictional data and the free local mock AI: no paid API calls.',
    6000,
  );

  // ---- 1. Resume import ------------------------------------------------------------
  await caption(
    '1 · Profile: import a resume. PDF and DOCX files are parsed on your device.',
    1500,
  );
  await click(panel.getByRole('tab', { name: 'Profile' }));
  await click(panel.getByRole('button', { name: 'Upload a resume' }));
  await panel.getByLabel('Choose a file').setInputFiles(RESUME);
  await panel.getByRole('heading', { name: /^Review/ }).waitFor();
  await caption('You review and correct every parsed field before anything is saved.', 1500);
  await scroll(panel, 900);
  await scroll(panel, 900);
  await click(panel.getByRole('button', { name: 'Save to profile' }));
  await expect(panel.getByText('Your profile was saved from this resume.')).toBeVisible();
  await pause(1500);

  // ---- 2. Job analysis -------------------------------------------------------------
  await caption('2 · Job analysis: ApplyPilot reads the posting open on the left.', 1000);
  await click(panel.getByRole('tab', { name: 'Analyze' }));
  await click(panel.getByRole('button', { name: 'Analyze this page' }), 400);
  await panel.getByRole('heading', { name: 'Cloud Engineering Intern' }).waitFor();
  await caption(
    'Every extracted detail shows where it came from and how confident the reading is.',
  );
  await pause(1500);
  await scroll(left, 500);
  await scroll(panel, 500);
  await pause(1500);
  const match = panel.getByRole('region', { name: 'Match score' });
  await match.scrollIntoViewIfNeeded();
  await caption(
    'An explainable 0–100 match: evidence for each skill, gaps, and items to check yourself.',
  );
  await pause(3000);
  await scroll(panel, 500);
  await pause(2500);
  await scroll(left, -500);

  // ---- 3. AI tailoring -------------------------------------------------------------
  await caption(
    '3 · AI Tailor: nothing is sent to AI until you give consent and connect the local API.',
  );
  await click(panel.getByRole('tab', { name: 'AI Tailor' }), 1500);
  await click(panel.getByRole('button', { name: 'Allow AI processing' }));
  await click(panel.getByRole('button', { name: 'Open Settings' }));
  await caption('The Claude API key stays in the local ApplyPilot API, never in the extension.');
  for (const [label, value] of [
    ['API address', API_URL],
    ['Access token', API_TOKEN],
  ] as const) {
    await panel.getByLabel(label).fill('');
    await panel.getByLabel(label).pressSequentially(value, { delay: 20 });
  }
  await click(panel.getByRole('button', { name: 'Save and test connection' }), 400);
  await expect(panel.getByText('Connected to ApplyPilot API')).toBeVisible();
  await pause(2000);
  await click(panel.getByRole('tab', { name: 'AI Tailor' }));
  await caption(
    'Before each request you can see exactly what will be sent (contact details never are).',
  );
  await click(panel.getByText('What will be sent'), 2500);
  await scroll(panel, 400);
  await click(panel.getByRole('button', { name: 'Generate tailored resume' }), 400);
  await panel.getByRole('heading', { name: 'Skills to feature' }).waitFor();
  await caption(
    'A tailored resume draft built only from your profile; untraceable claims are removed or flagged.',
  );
  await pause(2000);
  await scroll(panel, 600);
  await pause(1500);
  await scroll(panel, 600);
  await pause(1500);
  await click(panel.getByRole('button', { name: 'Cover letter' }));
  await click(panel.getByRole('button', { name: 'Generate cover letter' }), 400);
  await panel.getByLabel('Cover letter (edit before you use it)').waitFor();
  await caption('Cover letter draft: fully editable, saved automatically for this job.');
  await pause(1500);
  await scroll(panel, 500);
  await pause(2500);

  // ---- 4. Autofill -----------------------------------------------------------------
  await left.goto(`${FIXTURES}/applications/conditional-application.html`);
  await left.bringToFront();
  await caption('4 · Assisted autofill on a practice application form (left).', 1500);
  await click(panel.getByRole('tab', { name: 'Autofill' }));
  await click(panel.getByRole('button', { name: 'Scan this form' }), 400);
  await panel.getByText('Apply: Cloud Support Intern').waitFor();
  await caption('Each proposed value shows its source. You approve fields one by one.');
  await pause(2500);
  const review = panel.getByRole('region', { name: 'Check these' });
  const github = 'Do you have a public GitHub profile?';
  await click(review.getByRole('checkbox', { name: `Fill ${github}` }));
  const other = panel.getByRole('region', { name: 'Not recognised or not supported' });
  const aws = other.getByLabel('Value for Have you used AWS in a project or job?');
  await show(aws);
  await aws.selectOption({ label: 'Yes' });
  await pause(800);
  const manual = panel.getByRole('region', { name: 'You answer these on the page' });
  await manual.scrollIntoViewIfNeeded();
  await caption(
    'Work authorization, sponsorship, pay, demographic and consent questions stay locked for you.',
  );
  await pause(3500);
  await click(panel.getByRole('button', { name: 'Fill 4 approved fields' }), 400);
  await expect(panel.getByRole('status', { name: 'Fill results' })).toContainText(
    'Filled 4 fields',
  );
  await caption('Only approved fields are filled. ApplyPilot never clicks Next or Submit.');
  await pause(1500);
  await scroll(left, 350);
  await pause(1500);
  await expect(panel.getByText('3 new questions found')).toBeVisible();
  await panel.getByText('3 new questions found').scrollIntoViewIfNeeded();
  await caption(
    'Answers revealed follow-up questions: they are found automatically and wait for your tick.',
  );
  await pause(2500);
  await click(panel.getByRole('checkbox', { name: 'Fill GitHub URL' }));
  await click(panel.getByRole('checkbox', { name: 'Fill Highest level of education' }));
  await click(panel.getByRole('button', { name: 'Fill 2 approved fields' }), 1500);
  await scroll(left, 300);
  await pause(2500);
  await scroll(left, -650);

  // ---- 5. Tracking -----------------------------------------------------------------
  await left.goto(`${FIXTURES}/jobs/json-ld-cloud-intern.html`);
  await left.bringToFront();
  await caption(
    '5 · Application tracker: save the job you analyzed and track it to an offer.',
    1000,
  );
  await click(panel.getByRole('tab', { name: 'Analyze' }));
  await click(panel.getByRole('button', { name: /Analyze this page|Re-analyze/ }), 400);
  await panel.getByRole('heading', { name: 'Cloud Engineering Intern' }).waitFor();
  const tracker = panel.getByLabel('Application tracker');
  await click(tracker.getByRole('button', { name: 'Save to tracker' }));
  await expect(tracker).toContainText('In your tracker');
  await click(tracker.getByRole('button', { name: 'Open' }), 1200);
  const card = panel.getByRole('article', { name: 'Cloud Engineering Intern at Northwind Cloud' });
  const status = card.getByLabel('Status for Cloud Engineering Intern');
  await show(status);
  await status.selectOption('applied');
  await pause(1000);
  await caption(
    'Statuses keep their history; notes and follow-up reminders stay on your computer.',
  );
  await card
    .getByLabel('New note')
    .pressSequentially('Applied through the careers site', { delay: 30 });
  await click(card.getByRole('button', { name: 'Add note' }));
  const followUp = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  await card.getByLabel('Follow-up date').fill(followUp);
  await click(card.getByRole('button', { name: 'Save reminder' }), 1500);
  await caption('Analytics come from your own records; export to CSV at any time.');
  await click(panel.getByRole('button', { name: 'Analytics' }), 3500);
  await scroll(panel, 500);
  await pause(2500);

  await caption(
    'ApplyPilot AI: you stay in control. Nothing is submitted or claimed without your approval.',
    4000,
  );

  const end = Date.now();
  for (const stop of stops) await stop();
  writeFileSync(
    resolve(OUT, 'timeline.json'),
    JSON.stringify({ start, end, left: LEFT, panel: PANEL, frames, captions }, null, 2),
  );
  await context.close();
});
