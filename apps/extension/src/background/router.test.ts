import { describe, expect, it, vi } from 'vitest';
import { extractJob } from '@applypilot/job-extraction';
import { ok, type JobExtractionResult } from '@applypilot/shared';
import {
  CONTENT_WAIT_MS,
  PERMISSION_MESSAGE,
  handleBackgroundMessage,
  type BackgroundDeps,
} from './router';

function sampleResult(): JobExtractionResult {
  document.body.innerHTML = '<h1>Platform Intern</h1>';
  return extractJob(document, 'https://careers.example.com/jobs/1', {
    now: () => new Date('2026-10-14T00:00:00Z'),
  });
}

function makeDeps(
  overrides: Partial<BackgroundDeps> = {},
): BackgroundDeps & { cached: Map<number, unknown> } {
  const cached = new Map<number, unknown>();
  return {
    cached,
    version: '0.1.0',
    getActiveTab: () => Promise.resolve({ id: 3, url: 'https://careers.example.com/jobs/1' }),
    injectContentScript: vi.fn(() => Promise.resolve()),
    sendToTab: vi.fn(() => Promise.resolve(ok(sampleResult()))),
    cache: {
      get: (tabId) => Promise.resolve(cached.get(tabId)),
      set: (tabId, result) => {
        cached.set(tabId, result);
        return Promise.resolve();
      },
    },
    shouldCache: () => Promise.resolve(true),
    ...overrides,
  };
}

describe('handleBackgroundMessage', () => {
  it('rejects malformed and unknown messages', async () => {
    const deps = makeDeps();
    for (const message of [
      null,
      'ping',
      { type: 'job/submit-application' },
      { type: 'job/get-cached', tabId: 'x' },
    ]) {
      await expect(handleBackgroundMessage(message, deps)).resolves.toMatchObject({
        ok: false,
        error: { code: 'INVALID_MESSAGE' },
      });
    }
  });

  it('answers pings with the version', async () => {
    await expect(handleBackgroundMessage({ type: 'app/ping' }, makeDeps())).resolves.toEqual({
      ok: true,
      data: { version: '0.1.0' },
    });
  });

  it('extracts the active tab, validates the reply and caches it', async () => {
    const deps = makeDeps();
    const response = await handleBackgroundMessage({ type: 'job/extract-active-tab' }, deps);
    expect(response.ok).toBe(true);
    expect(deps.injectContentScript).toHaveBeenCalledWith(3);
    expect(deps.sendToTab).toHaveBeenCalledWith(3, {
      type: 'content/extract-job',
      waitMs: CONTENT_WAIT_MS,
    });
    expect(deps.cached.has(3)).toBe(true);
    await expect(
      handleBackgroundMessage({ type: 'job/get-cached', tabId: 3 }, deps),
    ).resolves.toMatchObject({ ok: true, data: { platform: 'generic' } });
  });

  it('drops the cached analysis once the tab shows a different job', async () => {
    const search = (key: string) => `https://www.indeed.com/jobs?q=security&vjk=${key}`;
    const deps = makeDeps({
      getActiveTab: () => Promise.resolve({ id: 3, url: search('3c9d2e8f71a04b65') }),
    });
    deps.cached.set(3, { ...sampleResult(), pageUrl: search('b5e7a1c3d9f20486') });
    await expect(
      handleBackgroundMessage({ type: 'job/get-cached', tabId: 3 }, deps),
    ).resolves.toEqual({ ok: true, data: null });

    // The same job reached with other search parameters is still the same job.
    deps.cached.set(3, { ...sampleResult(), pageUrl: `${search('3c9d2e8f71a04b65')}&from=serp` });
    const same = await handleBackgroundMessage({ type: 'job/get-cached', tabId: 3 }, deps);
    expect(same.ok && (same.data as JobExtractionResult).pageUrl).toContain('3c9d2e8f');
  });

  it('does not cache when the user turned caching off', async () => {
    const deps = makeDeps({ shouldCache: () => Promise.resolve(false) });
    await handleBackgroundMessage({ type: 'job/extract-active-tab' }, deps);
    expect(deps.cached.size).toBe(0);
  });

  it('asks for a toolbar click when the tab URL is not visible', async () => {
    const deps = makeDeps({ getActiveTab: () => Promise.resolve({ id: 3 }) });
    await expect(
      handleBackgroundMessage({ type: 'job/extract-active-tab' }, deps),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'PERMISSION_REQUIRED', message: PERMISSION_MESSAGE },
    });
    expect(deps.injectContentScript).not.toHaveBeenCalled();
  });

  it.each([
    'chrome://extensions',
    'https://chromewebstore.google.com/detail/x',
    'file:///tmp/job.html',
  ])('refuses restricted page %s', async (url) => {
    const deps = makeDeps({ getActiveTab: () => Promise.resolve({ id: 3, url }) });
    await expect(
      handleBackgroundMessage({ type: 'job/extract-active-tab' }, deps),
    ).resolves.toMatchObject({ error: { code: 'UNSUPPORTED_PAGE' } });
  });

  it('maps injection permission failures to PERMISSION_REQUIRED', async () => {
    const deps = makeDeps({
      injectContentScript: () => Promise.reject(new Error('Cannot access contents of the page.')),
    });
    await expect(
      handleBackgroundMessage({ type: 'job/extract-active-tab' }, deps),
    ).resolves.toMatchObject({ error: { code: 'PERMISSION_REQUIRED' } });
  });

  it('rejects malformed replies from the page', async () => {
    const deps = makeDeps({
      sendToTab: () => Promise.resolve({ ok: true, data: { title: 'injected' } }),
    });
    await expect(
      handleBackgroundMessage({ type: 'job/extract-active-tab' }, deps),
    ).resolves.toMatchObject({ error: { code: 'EXTRACTION_FAILED' } });
    expect(deps.cached.size).toBe(0);
  });

  it('ignores corrupted cache entries', async () => {
    const deps = makeDeps();
    deps.cached.set(9, { junk: true });
    await expect(
      handleBackgroundMessage({ type: 'job/get-cached', tabId: 9 }, deps),
    ).resolves.toEqual({ ok: true, data: null });
  });
});
