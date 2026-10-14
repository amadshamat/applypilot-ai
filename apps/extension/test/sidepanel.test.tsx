import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JSDOM } from 'jsdom';
import { extractJob } from '@applypilot/job-extraction';
import { fail, ok, type BackgroundRequest } from '@applypilot/shared';
import { useAnalysis } from '../src/features/analyze/store';
import { useNavigation } from '../src/features/navigation/store';
import { ServicesProvider } from '../src/services/services-provider';
import { SidePanelApp } from '../src/sidepanel/app';
import { fakeServices } from './fakes';

const FIXTURES = resolve(import.meta.dirname, '../../../tests/fixtures/jobs');

function fixtureResult(name: string, url: string) {
  const doc = new JSDOM(readFileSync(resolve(FIXTURES, name), 'utf8'), { url }).window.document;
  return extractJob(doc, url);
}

function renderPanel(handler?: (request: BackgroundRequest) => unknown) {
  const fake = fakeServices(handler);
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
      'Resume',
      'Applications',
      'AI Copilot',
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
    expect(screen.getByText(/shows no score rather than a made-up one/)).toBeInTheDocument();
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

    expect(await screen.findByText(/All local ApplyPilot data was deleted/)).toBeInTheDocument();
    expect(await services.localStore.get('applypilot.example')).toBeUndefined();
  });
});
