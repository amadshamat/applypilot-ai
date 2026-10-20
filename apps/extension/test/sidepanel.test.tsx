import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JSDOM } from 'jsdom';
import { extractJob } from '@applypilot/job-extraction';
import { fail, ok, type BackgroundRequest } from '@applypilot/shared';
import { useAnalysis } from '../src/features/analyze/store';
import { useNavigation } from '../src/features/navigation/store';
import { ServicesProvider } from '../src/services/services-provider';
import { SidePanelApp } from '../src/sidepanel/app';
import { fakeServices, type FakeOptions } from './fakes';

const FIXTURES = resolve(import.meta.dirname, '../../../tests/fixtures/jobs');

function fixtureResult(name: string, url: string) {
  const doc = new JSDOM(readFileSync(resolve(FIXTURES, name), 'utf8'), { url }).window.document;
  return extractJob(doc, url);
}

const SUNSTATES = 'b5e7a1c3d9f20486';
const SUNSTATES_URL = `https://www.indeed.com/jobs?q=security+officer&l=Alexandria%2C+VA&vjk=${SUNSTATES}`;

/** The reported Indeed search page, with the details frame's content placed inline. */
function sunstatesResult() {
  const doc = new JSDOM(readFileSync(resolve(FIXTURES, 'indeed-search-frame-panel.html'), 'utf8'), {
    url: SUNSTATES_URL,
  }).window.document;
  const panel = readFileSync(resolve(FIXTURES, 'indeed-embedded-sunstates.html'), 'utf8');
  doc.querySelector('.jobsearch-RightPane')!.innerHTML =
    `<div id="jobsearch-ViewjobPaneWrapper">${/<body>([\s\S]*)<\/body>/.exec(panel)?.[1] ?? ''}</div>`;
  return extractJob(doc, SUNSTATES_URL);
}

function renderPanel(handler?: (request: BackgroundRequest) => unknown, options: FakeOptions = {}) {
  const fake = fakeServices(handler, options);
  render(
    <ServicesProvider services={fake.services}>
      <SidePanelApp />
    </ServicesProvider>,
  );
  return fake;
}

beforeEach(() => {
  useAnalysis.setState({ state: { status: 'idle' } });
  useNavigation.setState({ view: 'analyze' });
});

describe('side panel navigation', () => {
  it('shows all primary sections and switches views on click', async () => {
    renderPanel();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('aria-label'))).toEqual([
      'Analyze',
      'Autofill',
      'Profile',
      'Applications',
      'AI Tailor',
      'Settings',
    ]);
    expect(screen.getByRole('tab', { name: 'Analyze' })).toHaveAttribute('aria-selected', 'true');

    await userEvent.click(screen.getByRole('tab', { name: 'Applications' }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Application tracking');
    expect(screen.getByText(/Not built yet · Phase 5/)).toBeInTheDocument();
  });

  it('supports arrow-key navigation between tabs', async () => {
    renderPanel();
    screen.getByRole('tab', { name: 'Analyze' }).focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Analyze' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('analyze view', () => {
  it('analyzes the page and shows extracted fields with provenance', async () => {
    const result = fixtureResult(
      'json-ld-cloud-intern.html',
      'http://127.0.0.1/jobs/json-ld-cloud-intern.html',
    );
    const { send } = renderPanel((request) =>
      request.type === 'job/extract-active-tab' ? ok(result) : ok(null),
    );

    await userEvent.click(await screen.findByRole('button', { name: /Analyze this page/ }));

    expect(
      await screen.findByRole('heading', { name: 'Cloud Engineering Intern' }),
    ).toBeInTheDocument();
    expect(send).toHaveBeenCalledWith({ type: 'job/extract-active-tab' });
    expect(screen.getAllByText('Northwind Cloud').length).toBeGreaterThan(0);
    expect(screen.getByText('$28 – $34 per hour')).toBeInTheDocument();
    expect(screen.getByText('Nov 15, 2026')).toBeInTheDocument();
    const skills = screen.getByRole('list', { name: 'Skills' });
    expect(within(skills).getByText('Terraform')).toBeInTheDocument();
    // Unknown values are labelled, not invented.
    expect(screen.getAllByText('Not found').length).toBeGreaterThan(0);
    // With no profile there is no score, only a way to build one.
    const match = screen.getByRole('region', { name: 'Match score' });
    expect(
      await within(match).findByRole('button', { name: /Build your profile/ }),
    ).toBeInTheDocument();
    expect(within(match).queryByLabelText(/Match score \d+/)).not.toBeInTheDocument();
  });

  it('shows Indeed results with a minimum-only salary and several job types', async () => {
    const url = 'https://www.indeed.com/jobs?q=fundraiser&vjk=7c1e5f0a2b3d4e6f';
    const result = fixtureResult('indeed-search-selected-job.html', url);
    renderPanel((request) => (request.type === 'job/extract-active-tab' ? ok(result) : ok(null)));
    await userEvent.click(await screen.findByRole('button', { name: /Analyze this page/ }));
    expect(
      await screen.findByRole('heading', {
        name: 'Fundraiser – $20/hr Guaranteed – Great for Students & Creatives',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Indeed')).toBeInTheDocument();
    expect(screen.getByText('From $20 per hour')).toBeInTheDocument();
    expect(screen.getAllByText('Part-time, Full-time').length).toBe(2);
    expect(screen.queryByText(/Hello, Jordan/)).not.toBeInTheDocument();
  });

  it('shows only the selected Indeed job and how it was read (Sunstates report)', async () => {
    const result = sunstatesResult();
    renderPanel((request) => (request.type === 'job/extract-active-tab' ? ok(result) : ok(null)), {
      tabUrl: SUNSTATES_URL,
    });
    await userEvent.click(await screen.findByRole('button', { name: /Analyze this page/ }));
    expect(
      await screen.findByRole('heading', { name: 'FT Unarmed Security Officer – $20.89/hr' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Sunstates Security').length).toBeGreaterThan(0);
    expect(screen.getByText('Alexandria, VA', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('$20.89 per hour')).toBeInTheDocument();
    expect(screen.queryByText(/Job Search/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Z S Connections/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No job is open/)).not.toBeInTheDocument();

    expect(screen.getByText(/all checks passed/)).toBeInTheDocument();
    const checks = screen.getByRole('list', { name: 'Extraction checks', hidden: true });
    expect(checks).toHaveTextContent('Read from the job details panel');
    expect(checks).toHaveTextContent('The details panel title matches the selected result.');
  });

  it('copies a bug-report summary without the job text', async () => {
    const u = userEvent.setup();
    const result = sunstatesResult();
    renderPanel((request) => (request.type === 'job/extract-active-tab' ? ok(result) : ok(null)));
    await u.click(await screen.findByRole('button', { name: /Analyze this page/ }));
    await u.click(await screen.findByText('How this was read'));
    await u.click(screen.getByRole('button', { name: /Copy details for a bug report/ }));
    const copied = await navigator.clipboard.readText();
    expect(JSON.parse(copied)).toMatchObject({
      platform: 'indeed',
      diagnostics: { scope: 'selected-job', selectedJobId: SUNSTATES },
      fields: { title: 'adapter/high', company: 'adapter/high' },
    });
    expect(copied).not.toContain('DCJS');
    expect(await screen.findByText(/Copied/)).toBeInTheDocument();
  });

  it('notices when another Indeed job is selected and re-analyzes on request', async () => {
    const first = sunstatesResult();
    let calls = 0;
    const { navigateTab } = renderPanel(
      (request) => {
        if (request.type !== 'job/extract-active-tab') return ok(null);
        calls += 1;
        return ok(first);
      },
      { tabUrl: SUNSTATES_URL },
    );
    await userEvent.click(await screen.findByRole('button', { name: /Analyze this page/ }));
    await screen.findByRole('heading', { name: 'FT Unarmed Security Officer – $20.89/hr' });
    expect(screen.queryByText('The selected job changed')).not.toBeInTheDocument();

    // The user clicks another card: Indeed changes only the vjk in the address.
    act(() => navigateTab(SUNSTATES_URL.replace(SUNSTATES, '3c9d2e8f71a04b65')));
    expect(await screen.findByText('The selected job changed')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Analyze selected job/ }));
    await waitFor(() => expect(calls).toBe(2));
  });

  it('restores a cached analysis for the active tab', async () => {
    const result = fixtureResult(
      'greenhouse-software-intern.html',
      'https://job-boards.greenhouse.io/lumenrobotics/jobs/4012345007',
    );
    renderPanel((request) => (request.type === 'job/get-cached' ? ok(result) : ok(null)));
    expect(
      await screen.findByRole('heading', { name: 'Software Engineering Intern, Summer 2027' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Showing the earlier analysis of this tab.')).toBeInTheDocument();
  });

  it('explains permission errors and allows retrying', async () => {
    let calls = 0;
    renderPanel((request) => {
      if (request.type !== 'job/extract-active-tab') return ok(null);
      calls += 1;
      return fail('PERMISSION_REQUIRED', 'Click the ApplyPilot icon in the Chrome toolbar.');
    });
    await userEvent.click(await screen.findByRole('button', { name: /Analyze this page/ }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Permission needed for this page');
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(calls).toBe(2));
  });

  it('warns when the page is not a job posting', async () => {
    const result = fixtureResult('not-a-job.html', 'https://harborline.example/blog/lambda');
    renderPanel((request) => (request.type === 'job/extract-active-tab' ? ok(result) : ok(null)));
    await userEvent.click(await screen.findByRole('button', { name: /Analyze this page/ }));
    expect(await screen.findByText('This may not be a job posting')).toBeInTheDocument();
  });
});

describe('job in a protected Indeed frame (PaperMoon report)', () => {
  const PAPERMOON = 'e1f2a3b4c5d6e7f8';
  const SEARCH = `https://www.indeed.com/jobs?q=server+bartender&vjk=${PAPERMOON}`;
  const FRAME = `https://jobs.indeed.com/viewjob?jk=${PAPERMOON}&viewtype=embedded`;

  /** What the page reports when Chrome keeps the details frame from it. */
  function blockedResult() {
    const doc = new JSDOM(readFileSync(resolve(FIXTURES, 'indeed-search-papermoon.html'), 'utf8'), {
      url: SEARCH,
    }).window.document;
    const frame = doc.querySelector('iframe')!;
    frame.setAttribute('src', FRAME);
    Object.defineProperty(frame, 'contentDocument', { get: () => null });
    return extractJob(doc, SEARCH);
  }

  function frameResult() {
    return { ...fixtureResult('indeed-embedded-papermoon.html', FRAME), pageUrl: SEARCH };
  }

  it('asks for Indeed access from a click and analyzes again once granted', async () => {
    const u = userEvent.setup();
    let granted = false;
    const fake = renderPanel(
      (request) =>
        request.type === 'job/extract-active-tab'
          ? ok(granted ? frameResult() : blockedResult())
          : ok(null),
      { tabUrl: SEARCH, permission: { granted: false, grantOnRequest: true } },
    );
    await u.click(await screen.findByRole('button', { name: /Analyze this page/ }));
    expect(
      await screen.findByText('Indeed shows this job in a protected frame'),
    ).toBeInTheDocument();
    expect(screen.getByText(/https:\/\/jobs\.indeed\.com/)).toBeInTheDocument();
    // Nothing is requested until the user clicks.
    expect(fake.services.permissions.request).not.toHaveBeenCalled();

    granted = true;
    await u.click(screen.getByRole('button', { name: /Allow reading Indeed job details/ }));
    expect(fake.services.permissions.request).toHaveBeenCalledWith('https://*.indeed.com/*');
    expect(await screen.findByRole('heading', { name: 'Server / Bartender' })).toBeInTheDocument();
    expect(screen.getAllByText('PaperMoon Springfield').length).toBeGreaterThan(0);
    expect(
      screen.queryByText('Indeed shows this job in a protected frame'),
    ).not.toBeInTheDocument();
  });

  it('offers pasting the job when access is declined', async () => {
    const u = userEvent.setup();
    renderPanel(
      (request) => (request.type === 'job/extract-active-tab' ? ok(blockedResult()) : ok(null)),
      { tabUrl: SEARCH, permission: { granted: false, grantOnRequest: false } },
    );
    await u.click(await screen.findByRole('button', { name: /Analyze this page/ }));
    await u.click(await screen.findByRole('button', { name: /Allow reading Indeed job details/ }));
    expect(await screen.findByText(/Access was not granted/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Paste the job instead/ })).toBeInTheDocument();
  });

  it('analyzes a pasted job and checks the form first', async () => {
    const u = userEvent.setup();
    renderPanel(() => ok(null), { tabUrl: SEARCH });
    await u.click(await screen.findByRole('button', { name: /Paste the job instead/ }));
    const form = screen.getByRole('form', { name: 'Paste a job' });
    await u.click(within(form).getByRole('button', { name: 'Analyze pasted job' }));
    expect(within(form).getByText('Enter the job title.')).toBeInTheDocument();
    expect(within(form).getByText(/Paste the job description/)).toBeInTheDocument();

    await u.type(within(form).getByLabelText('Job title'), 'Server / Bartender');
    await u.type(within(form).getByLabelText('Company (optional)'), 'PaperMoon Springfield');
    await u.click(within(form).getByLabelText('Job description'));
    await u.paste(
      'PaperMoon Springfield is a family restaurant looking for a friendly server and bartender for evening shifts.\nJob Type: Part-time\nPay: $15.54 - $17.29 per hour',
    );
    await u.click(within(form).getByRole('button', { name: 'Analyze pasted job' }));

    expect(await screen.findByRole('heading', { name: 'Server / Bartender' })).toBeInTheDocument();
    expect(screen.getByText(/Analyzed from the text you pasted/)).toBeInTheDocument();
    // A bare $ is not assumed to be US dollars.
    expect(screen.getByText('15.54 – 17.29 (currency not stated) per hour')).toBeInTheDocument();
    expect(screen.getByText('Only the text you pasted was read.')).toBeInTheDocument();
    expect(screen.getAllByText('You entered').length).toBeGreaterThan(0);
  });
});

describe('settings view', () => {
  it('saves valid settings and blocks weights that do not total 100', async () => {
    const { services } = renderPanel();
    await userEvent.click(screen.getByRole('tab', { name: 'Settings' }));

    const education = await screen.findByLabelText('Education and eligibility');
    await userEvent.clear(education);
    await userEvent.type(education, '25');
    expect(await screen.findByText('Total: 110%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Allow AI processing' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save settings' })).toBeEnabled(),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByText('Settings saved')).toBeInTheDocument();
    await expect(services.settings.load()).resolves.toMatchObject({
      allowAiProcessing: true,
      matchWeights: { education: 15 },
    });
  });

  it('deletes local data only after confirmation', async () => {
    const { services } = renderPanel();
    await services.localStore.set('applypilot.example', { keep: 'me' });
    await userEvent.click(screen.getByRole('tab', { name: 'Settings' }));

    await userEvent.click(await screen.findByRole('button', { name: /Delete all local data/ }));
    expect(await services.localStore.get('applypilot.example')).toEqual({ keep: 'me' });
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete everything' }));

    expect(
      await screen.findByText(
        /All local ApplyPilot data, including your profile, resumes, AI drafts and the API token, was deleted/,
      ),
    ).toBeInTheDocument();
    expect(await services.localStore.get('applypilot.example')).toBeUndefined();
  });
});
