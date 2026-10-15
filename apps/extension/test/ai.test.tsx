import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JSDOM } from 'jsdom';
import { extractJob } from '@applypilot/job-extraction';
import type { AiTask, TaskResponse } from '@applypilot/ai-core';
import { sampleProfile } from '../../../packages/ai-core/test/fixtures';
import { createApi } from '../../../services/api/src/app';
import { createMockProvider } from '../../../services/api/src/providers/mock';
import { useAnalysis } from '../src/features/analyze/store';
import { useNavigation } from '../src/features/navigation/store';
import { createAiClient, type AiClient } from '../src/services/ai-client';
import { ServicesProvider } from '../src/services/services-provider';
import { SidePanelApp } from '../src/sidepanel/app';
import { DEFAULT_API_URL } from '../src/storage/ai-connection-repository';
import { jobKeyFor } from '../src/storage/ai-drafts-repository';
import { fakeServices, type FakeOptions } from './fakes';

const TOKEN = 'local-test-token-abcdefghijklmnop';
const JOB_URL = 'http://127.0.0.1/jobs/json-ld-cloud-intern.html';

function analyzedJob() {
  const html = readFileSync(
    resolve(import.meta.dirname, '../../../tests/fixtures/jobs/json-ld-cloud-intern.html'),
    'utf8',
  );
  return extractJob(new JSDOM(html, { url: JOB_URL }).window.document, JOB_URL);
}

/**
 * The real API (mock provider) behind a fake fetch, so the extension's client,
 * validation and UI are exercised against the actual server logic.
 */
function localApi(dailyLimit = 25) {
  const handle = createApi({
    config: {
      version: '0.1.0',
      host: '127.0.0.1',
      port: 8787,
      token: TOKEN,
      provider: 'mock',
      anthropicApiKey: null,
      model: 'claude-opus-5-5',
      effort: 'medium',
      dailyLimit,
      allowedOrigins: [],
      maxBodyBytes: 300_000,
    },
    provider: createMockProvider(),
  });
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers = new Headers(init?.headers);
    const res = await handle({
      method: init?.method ?? 'GET',
      path: url.pathname,
      headers: {
        authorization: headers.get('authorization') ?? undefined,
        'content-type': headers.get('content-type') ?? undefined,
      },
      body: typeof init?.body === 'string' ? init.body : '',
    });
    return new Response(JSON.stringify(res.body), { status: res.status });
  });
  return { client: createAiClient(fetchImpl), fetchImpl };
}

function sentBodies(fetchImpl: ReturnType<typeof localApi>['fetchImpl'], path: string) {
  return fetchImpl.mock.calls
    .filter(([url]) => (url instanceof Request ? url.url : url.toString()).endsWith(path))
    .map(([, init]) => JSON.parse(init?.body as string) as Record<string, unknown>);
}

interface Setup {
  consent?: boolean;
  token?: string;
  profile?: boolean;
  analyzed?: boolean;
  ai?: AiClient;
  permission?: FakeOptions['permission'];
  tabUrl?: string | null;
}

async function renderAi({
  consent = true,
  token = TOKEN,
  profile = true,
  analyzed = true,
  ai,
  permission,
  tabUrl = null,
}: Setup = {}) {
  const api = localApi();
  const fake = fakeServices(undefined, {
    ai: ai ?? api.client,
    tabUrl,
    ...(permission ? { permission } : {}),
  });
  await fake.services.settings.update({ allowAiProcessing: consent });
  if (token) await fake.services.aiConnection.save({ apiUrl: DEFAULT_API_URL, token });
  if (profile) await fake.services.profile.save(sampleProfile());
  if (analyzed) {
    useAnalysis.setState({ state: { status: 'success', result: analyzedJob(), fromCache: false } });
  }
  useNavigation.setState({ view: 'tailor' });
  const view = render(
    <ServicesProvider services={fake.services}>
      <SidePanelApp />
    </ServicesProvider>,
  );
  return { ...fake, ...api, view };
}

const user = () => userEvent.setup();

beforeEach(() => {
  useAnalysis.setState({ state: { status: 'idle' } });
  useNavigation.setState({ view: 'analyze' });
});

describe('AI Tailor and job switching', () => {
  it('stops drafting from an analysis once the tab shows another job', async () => {
    const { navigateTab, fetchImpl } = await renderAi({ tabUrl: JOB_URL });
    expect(
      await screen.findByRole('button', { name: 'Generate tailored resume' }),
    ).toBeInTheDocument();

    act(() => navigateTab('http://127.0.0.1/jobs/generic-devops-role.html'));
    expect(await screen.findByText('The selected job changed')).toBeInTheDocument();
    expect(screen.getByText(/This analysis is for “Cloud Engineering Intern”/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Generate tailored resume' }),
    ).not.toBeInTheDocument();
    expect(sentBodies(fetchImpl, '/v1/tailor-resume')).toHaveLength(0);

    // Coming back to the analyzed job brings the tools back.
    act(() => navigateTab(`${JOB_URL}#apply`));
    expect(
      await screen.findByRole('button', { name: 'Generate tailored resume' }),
    ).toBeInTheDocument();
  });

  it('keeps drafts for two Indeed jobs from the same search apart', () => {
    const search = 'https://www.indeed.com/jobs?q=security+officer&l=Alexandria%2C+VA';
    expect(jobKeyFor(`${search}&vjk=b5e7a1c3d9f20486`)).not.toBe(
      jobKeyFor(`${search}&vjk=3c9d2e8f71a04b65`),
    );
    expect(jobKeyFor(`${search}&vjk=b5e7a1c3d9f20486`)).toBe(
      jobKeyFor('https://www.indeed.com/viewjob?jk=b5e7a1c3d9f20486&from=serp'),
    );
  });
});

describe('AI Tailor prerequisites', () => {
  it('asks for consent first and records it only when the user clicks', async () => {
    const u = user();
    const { services } = await renderAi({ consent: false });
    expect(await screen.findByText('AI processing is off')).toBeInTheDocument();
    await expect(services.settings.load()).resolves.toMatchObject({ allowAiProcessing: false });
    await u.click(screen.getByRole('button', { name: 'Allow AI processing' }));
    await expect(services.settings.load()).resolves.toMatchObject({ allowAiProcessing: true });
    expect(await screen.findByText(/Mock mode: free drafts/)).toBeInTheDocument();
  });

  it('asks for a connection when no token is saved', async () => {
    const u = user();
    await renderAi({ token: '' });
    expect(await screen.findByText('Connect the ApplyPilot API')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(await screen.findByText('AI connection')).toBeInTheDocument();
  });

  it('asks for a profile, then for an analyzed job', async () => {
    await renderAi({ profile: false });
    expect(await screen.findByText('Build your profile first')).toBeInTheDocument();
  });

  it('asks to analyze a job when none is loaded', async () => {
    await renderAi({ analyzed: false });
    expect(await screen.findByText('Analyze a job first')).toBeInTheDocument();
  });

  it('shows when the API cannot be reached', async () => {
    await renderAi({ token: 'wrong-token-but-long-enough-xx' });
    expect(await screen.findByText('The ApplyPilot API is not reachable')).toBeInTheDocument();
    expect(screen.getByText('Missing or wrong access token.')).toBeInTheDocument();
  });
});

describe('AI connection settings', () => {
  it('requests the local host permission, saves the token and tests the connection', async () => {
    const u = user();
    const { services } = await renderAi({ token: '' });
    useNavigation.setState({ view: 'settings' });
    await u.type(await screen.findByLabelText('Access token'), TOKEN);
    await u.click(screen.getByRole('button', { name: 'Save and test connection' }));
    expect(await screen.findByText('Connected to ApplyPilot API 0.1.0')).toBeInTheDocument();
    expect(services.permissions.request).toHaveBeenCalledWith('http://127.0.0.1/*');
    await expect(services.aiConnection.load()).resolves.toEqual({
      apiUrl: DEFAULT_API_URL,
      token: TOKEN,
    });
  });

  it('does not save anything when the permission is refused', async () => {
    const u = user();
    const { services } = await renderAi({
      token: '',
      permission: { granted: false, grantOnRequest: false },
    });
    useNavigation.setState({ view: 'settings' });
    await u.type(await screen.findByLabelText('Access token'), TOKEN);
    await u.click(screen.getByRole('button', { name: 'Save and test connection' }));
    expect(await screen.findByText(/needs permission to talk to the API/)).toBeInTheDocument();
    await expect(services.aiConnection.load()).resolves.toMatchObject({ token: '' });
  });

  it('rejects addresses that are not local', async () => {
    const u = user();
    await renderAi({ token: '' });
    useNavigation.setState({ view: 'settings' });
    const address = await screen.findByLabelText('API address');
    await u.clear(address);
    await u.type(address, 'https://example.com');
    expect(screen.getByText(/Use the local API address/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save and test connection' })).toBeDisabled();
  });
});

describe('resume tailoring', () => {
  it('generates a grounded draft, saves it, and restores it without a new request', async () => {
    const u = user();
    const { fetchImpl, services, view } = await renderAi();
    expect(await screen.findByText(/Mock mode: free drafts/)).toBeInTheDocument();

    // The preview shows what is sent; contact details are not in it.
    await u.click(screen.getByText('What will be sent'));
    expect(screen.getByText(/1 role with their bullets/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('avery@example.com');

    await u.click(screen.getByRole('button', { name: 'Generate tailored resume' }));
    expect(await screen.findByText('Skills to feature')).toBeInTheDocument();
    expect(screen.getByText(/^Automated EC2 snapshot cleanup/)).toBeInTheDocument();
    expect(screen.getByText(/Mock draft \(free, made offline\)/)).toBeInTheDocument();
    expect(screen.queryByText(/^Check:/)).not.toBeInTheDocument();

    const [sent] = sentBodies(fetchImpl, '/v1/tailor-resume');
    expect(JSON.stringify(sent)).not.toMatch(/avery@example\.com|555 0100|\$30\/hour|Avery Chen/);
    expect((await services.aiDrafts.list()).map((d) => d.task)).toEqual(['tailor-resume']);

    view.unmount();
    render(
      <ServicesProvider services={services}>
        <SidePanelApp />
      </ServicesProvider>,
    );
    expect(await screen.findByText(/· saved /)).toBeInTheDocument();
    expect(await screen.findByText('Skills to feature')).toBeInTheDocument();
    expect(sentBodies(fetchImpl, '/v1/tailor-resume')).toHaveLength(1);

    await u.click(screen.getByRole('button', { name: /Discard draft/ }));
    await waitFor(() => expect(screen.queryByText('Skills to feature')).not.toBeInTheDocument());
    await expect(services.aiDrafts.list()).resolves.toEqual([]);
  });

  it('removes untraceable content and flags invented numbers and skills', async () => {
    const u = user();
    const response: TaskResponse<'tailor-resume'> = {
      task: 'tailor-resume',
      promptVersion: 'tailor-resume@2026-10-14.1',
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      output: {
        summary: 'Student with 5 years of cloud experience.',
        experience: [
          {
            ref: 'E1',
            bullets: [
              { text: 'Cut storage costs by 40% with Terraform', basedOn: [0] },
              { text: 'Led a team of 8 engineers', basedOn: [] },
            ],
          },
          { ref: 'E7', bullets: [{ text: 'Made-up role', basedOn: [0] }] },
        ],
        projects: [],
        skillsToFeature: ['Python', 'Rust'],
        changes: [],
        notShownInProfile: [],
      },
      usage: { inputTokens: 4000, outputTokens: 2000, estimatedCostUsd: 0.056 },
      skipped: [],
      generatedAt: '2026-10-14T12:00:00.000Z',
    };
    const ai: AiClient = {
      health: () =>
        Promise.resolve({
          ok: true,
          service: 'applypilot-api',
          version: '0.1.0',
          provider: 'anthropic',
          model: 'claude-opus-5-5',
          requestsToday: 0,
          dailyLimit: 25,
        }),
      run: <T extends AiTask>() => Promise.resolve(response as unknown as TaskResponse<T>),
    };
    await renderAi({ ai });
    expect(await screen.findByText(/billed to the Anthropic account/)).toBeInTheDocument();
    await u.click(screen.getByText('What will be sent'));
    expect(screen.getByText(/Estimated cost: up to \$0\.\d\d/)).toBeInTheDocument();

    await u.click(screen.getByRole('button', { name: 'Generate tailored resume' }));
    const removed = await screen.findByText(/removed what it could not trace/);
    const alert = removed.closest('div')!.parentElement!;
    expect(within(alert).getByText(/Led a team of 8 engineers/)).toBeInTheDocument();
    expect(within(alert).getByText(/"E7"/)).toBeInTheDocument();
    expect(within(alert).getByText(/"Rust"/)).toBeInTheDocument();
    expect(screen.getByText(/Check: Uses "40"/)).toBeInTheDocument();
    expect(screen.getByText(/Check: Mentions Terraform/)).toBeInTheDocument();
    expect(screen.getByText(/Check: Uses "5"/)).toBeInTheDocument();
    expect(screen.getByText(/about \$0\.06/)).toBeInTheDocument();
  });

  it('shows API errors such as the daily limit', async () => {
    const u = user();
    await renderAi({ ai: localApi(1).client });
    await u.click(await screen.findByRole('button', { name: 'Generate tailored resume' }));
    expect(await screen.findByText('Skills to feature')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Generate again' }));
    expect(await screen.findByText('The draft could not be generated')).toBeInTheDocument();
    expect(screen.getByText(/daily limit of 1 AI requests/)).toBeInTheDocument();
  });
});

describe('cover letters', () => {
  it('sends the name and notes, and shows an editable letter', async () => {
    const u = user();
    const { fetchImpl } = await renderAi();
    await u.click(await screen.findByRole('button', { name: 'Cover letter' }));
    await u.selectOptions(screen.getByLabelText('Length'), 'short');
    await u.type(screen.getByLabelText('Your notes (optional)'), 'I use Contoso tools daily.');
    await u.click(screen.getByRole('button', { name: 'Generate cover letter' }));

    const letter = await screen.findByLabelText('Cover letter (edit before you use it)');
    expect((letter as HTMLTextAreaElement).value).toMatch(/^Dear Hiring Manager,/);
    expect((letter as HTMLTextAreaElement).value).toMatch(/Sincerely,\nAvery Chen$/);
    const [sent] = sentBodies(fetchImpl, '/v1/cover-letter');
    expect(sent).toMatchObject({
      candidate: { name: 'Avery Chen' },
      options: { length: 'short', notes: 'I use Contoso tools daily.' },
    });
    expect(JSON.stringify(sent)).not.toContain('avery@example.com');

    await u.type(letter, ' Edited.');
    await u.click(screen.getByRole('button', { name: 'Copy' }));
    await expect(navigator.clipboard.readText()).resolves.toMatch(/Avery Chen Edited\.$/);
    expect(screen.getByText('Copied')).toBeInTheDocument();
  });
});

describe('screening questions', () => {
  it('drafts only questions ApplyPilot may answer and never sends the others', async () => {
    const u = user();
    const { fetchImpl } = await renderAi();
    await u.click(await screen.findByRole('button', { name: 'Questions' }));
    await u.type(
      screen.getByLabelText('Questions'),
      'Describe your experience with AWS.\nWill you require visa sponsorship?\nWhat is your gender?',
    );
    const found = screen.getByRole('list', { name: 'Questions found' });
    expect(within(found).getAllByText('You answer')).toHaveLength(2);
    expect(within(found).getByText(/asks about work authorization/)).toBeInTheDocument();

    await u.click(screen.getByRole('button', { name: 'Draft 1 answer' }));
    const draft = await screen.findByLabelText('Draft answer (edit before you use it)');
    expect((draft as HTMLTextAreaElement).value).toMatch(/AWS Lambda/);
    const [sent] = sentBodies(fetchImpl, '/v1/screening-answers');
    expect(sent?.questions).toEqual([{ id: 'Q1', text: 'Describe your experience with AWS.' }]);
    expect(JSON.stringify(sent)).not.toMatch(/sponsorship|gender/);
  });

  it('cannot draft when every question is one the user must answer', async () => {
    const u = user();
    await renderAi();
    await u.click(await screen.findByRole('button', { name: 'Questions' }));
    await u.type(screen.getByLabelText('Questions'), 'Are you 18 years or older?');
    expect(screen.getByRole('button', { name: 'Draft 0 answers' })).toBeDisabled();
  });
});
