import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { vi } from 'vitest';
import { render } from '@testing-library/react';
import { JSDOM } from 'jsdom';
import { extractJob } from '@applypilot/job-extraction';
import { sampleProfile } from '../../../packages/ai-core/test/fixtures';
import { createApi } from '../../../services/api/src/app';
import { createMockProvider } from '../../../services/api/src/providers/mock';
import { useAnalysis } from '../src/features/analyze/store';
import { useNavigation } from '../src/features/navigation/store';
import { createAiClient, type AiClient } from '../src/services/ai-client';
import { ServicesProvider } from '../src/services/services-provider';
import { SidePanelApp } from '../src/sidepanel/app';
import { DEFAULT_API_URL } from '../src/storage/ai-connection-repository';
import { fakeServices, type FakeOptions } from './fakes';

/** The side panel on the AI Tailor tab, backed by the real API in mock mode. */

export const TOKEN = 'local-test-token-abcdefghijklmnop';
export const JOB_URL = 'http://127.0.0.1/jobs/json-ld-cloud-intern.html';

export function analyzedJob() {
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
export function localApi(dailyLimit = 25) {
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

export function sentBodies(fetchImpl: ReturnType<typeof localApi>['fetchImpl'], path: string) {
  return fetchImpl.mock.calls
    .filter(([url]) => (url instanceof Request ? url.url : url.toString()).endsWith(path))
    .map(([, init]) => JSON.parse(init?.body as string) as Record<string, unknown>);
}

export interface Setup {
  consent?: boolean;
  token?: string;
  profile?: boolean;
  analyzed?: boolean;
  ai?: AiClient;
  permission?: FakeOptions['permission'];
  tabUrl?: string | null;
}

export async function renderAi({
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
