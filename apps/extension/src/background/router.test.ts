import { describe, expect, it, vi } from 'vitest';
import { scanForm } from '@applypilot/autofill';
import { extractJob } from '@applypilot/job-extraction';
import { ok, type JobExtractionResult } from '@applypilot/shared';
import {
  CONTENT_WAIT_MS,
  FRAME_WAIT_MS,
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
    probeFrames: vi.fn(() => Promise.resolve([])),
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
    expect(deps.sendToTab).toHaveBeenCalledWith(
      3,
      { type: 'content/extract-job', waitMs: CONTENT_WAIT_MS },
      0,
    );
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

  it('does not look in frames when the page found the job itself', async () => {
    const deps = makeDeps({
      sendToTab: vi.fn(() => Promise.resolve(ok({ ...sampleResult(), isJobPosting: true }))),
    });
    await handleBackgroundMessage({ type: 'job/extract-active-tab' }, deps);
    expect(deps.probeFrames).not.toHaveBeenCalled();
  });

  describe('job details frames', () => {
    const SEARCH = 'https://www.indeed.com/jobs?q=server&vjk=e1f2a3b4c5d6e7f8';
    const FRAME = 'https://jobs.indeed.com/viewjob?jk=e1f2a3b4c5d6e7f8&viewtype=embedded';

    function pageResult(selectedJobId: string | null): JobExtractionResult {
      const base = sampleResult();
      return {
        ...base,
        pageUrl: SEARCH,
        isJobPosting: false,
        diagnostics: {
          scope: 'selected-job',
          selectedJobId,
          checks: [{ id: 'selected-job', status: 'pass', message: 'A result is selected.' }],
          blockedFrameOrigins: ['https://jobs.indeed.com'],
        },
      };
    }

    function frameResult(jobId: string): JobExtractionResult {
      const base = sampleResult();
      return {
        ...base,
        pageUrl: FRAME,
        isJobPosting: true,
        job: {
          ...base.job,
          jobId: { status: 'found', value: jobId, source: 'url', confidence: 'high' },
        },
      };
    }

    function frameDeps(selected: string | null, frames: { frameId: number; jobId: string }[]) {
      const sendToTab = vi.fn((_tab: number, _msg: unknown, frameId: number) => {
        if (frameId === 0) return Promise.resolve(ok(pageResult(selected)));
        const frame = frames.find((f) => f.frameId === frameId);
        return Promise.resolve(ok(frameResult(frame?.jobId ?? 'unknown')));
      });
      return makeDeps({
        getActiveTab: () => Promise.resolve({ id: 3, url: SEARCH }),
        sendToTab,
        probeFrames: vi.fn(() =>
          Promise.resolve([
            { frameId: 0, result: null },
            ...frames.map((f) => ({
              frameId: f.frameId,
              result: {
                url: `https://jobs.indeed.com/viewjob?jk=${f.jobId}`,
                isJobPosting: true,
                jobId: f.jobId,
                title: 'Server / Bartender',
              },
            })),
          ]),
        ),
      });
    }

    it('reads the frame that shows the selected job', async () => {
      const deps = frameDeps('e1f2a3b4c5d6e7f8', [
        { frameId: 4, jobId: 'aaaabbbbccccdddd' },
        { frameId: 7, jobId: 'e1f2a3b4c5d6e7f8' },
      ]);
      const response = await handleBackgroundMessage({ type: 'job/extract-active-tab' }, deps);
      expect(deps.sendToTab).toHaveBeenLastCalledWith(
        3,
        { type: 'content/extract-job', waitMs: FRAME_WAIT_MS, embedded: true },
        7,
      );
      expect(response).toMatchObject({
        ok: true,
        data: {
          isJobPosting: true,
          pageUrl: SEARCH,
          diagnostics: { via: 'frame', selectedJobId: 'e1f2a3b4c5d6e7f8' },
        },
      });
    });

    it('ignores frames that show a different job', async () => {
      const deps = frameDeps('e1f2a3b4c5d6e7f8', [{ frameId: 4, jobId: 'aaaabbbbccccdddd' }]);
      const response = await handleBackgroundMessage({ type: 'job/extract-active-tab' }, deps);
      expect(deps.sendToTab).toHaveBeenCalledTimes(1);
      expect(response).toMatchObject({ ok: true, data: { isJobPosting: false } });
    });

    it('ignores a frame whose content turns out to be another job', async () => {
      const deps = frameDeps('e1f2a3b4c5d6e7f8', [{ frameId: 4, jobId: 'aaaabbbbccccdddd' }]);
      // The probe claims the selected job, but the frame's extraction says otherwise.
      vi.mocked(deps.probeFrames).mockResolvedValue([
        {
          frameId: 4,
          result: { url: FRAME, isJobPosting: true, jobId: 'e1f2a3b4c5d6e7f8', title: null },
        },
      ]);
      const response = await handleBackgroundMessage({ type: 'job/extract-active-tab' }, deps);
      expect(deps.sendToTab).toHaveBeenCalledTimes(2);
      expect(response).toMatchObject({ ok: true, data: { isJobPosting: false } });
    });

    it('with no selection, uses a frame only when it is the only job frame', async () => {
      const two = frameDeps(null, [
        { frameId: 4, jobId: 'aaaabbbbccccdddd' },
        { frameId: 7, jobId: 'e1f2a3b4c5d6e7f8' },
      ]);
      await expect(
        handleBackgroundMessage({ type: 'job/extract-active-tab' }, two),
      ).resolves.toMatchObject({ data: { isJobPosting: false } });

      const one = frameDeps(null, [{ frameId: 7, jobId: 'e1f2a3b4c5d6e7f8' }]);
      await expect(
        handleBackgroundMessage({ type: 'job/extract-active-tab' }, one),
      ).resolves.toMatchObject({ data: { isJobPosting: true } });
    });

    it('keeps the page result when frames cannot be probed', async () => {
      const deps = frameDeps('e1f2a3b4c5d6e7f8', []);
      vi.mocked(deps.probeFrames).mockRejectedValue(new Error('Cannot access frame'));
      await expect(
        handleBackgroundMessage({ type: 'job/extract-active-tab' }, deps),
      ).resolves.toMatchObject({
        ok: true,
        data: { diagnostics: { blockedFrameOrigins: ['https://jobs.indeed.com'] } },
      });
    });
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

describe('autofill messages', () => {
  const scan = () => {
    document.body.innerHTML =
      '<form><input aria-label="Email" type="email"><input aria-label="Name"></form>';
    return scanForm(document, { now: () => new Date('2026-10-22T00:00:00Z') });
  };
  const instruction = {
    ref: 'f1',
    control: 'email' as const,
    label: 'Email',
    action: { type: 'text' as const, value: 'a@b.co' },
  };

  it('scans the active tab through the content script and validates the reply', async () => {
    const result = scan();
    const deps = makeDeps({ sendToTab: vi.fn(() => Promise.resolve(ok(result))) });
    await expect(handleBackgroundMessage({ type: 'autofill/scan' }, deps)).resolves.toEqual(
      ok(result),
    );
    expect(deps.sendToTab).toHaveBeenCalledWith(3, { type: 'content/scan-form' }, 0);

    const bad = makeDeps({
      sendToTab: vi.fn(() => Promise.resolve({ ok: true, data: { fields: 'x' } })),
    });
    await expect(handleBackgroundMessage({ type: 'autofill/scan' }, bad)).resolves.toMatchObject({
      ok: false,
      error: { code: 'SCAN_FAILED' },
    });
  });

  it('refuses restricted pages and pages it may not read', async () => {
    const chromePage = makeDeps({
      getActiveTab: () => Promise.resolve({ id: 1, url: 'chrome://settings' }),
    });
    await expect(
      handleBackgroundMessage({ type: 'autofill/scan' }, chromePage),
    ).resolves.toMatchObject({
      error: { code: 'UNSUPPORTED_PAGE' },
    });
    const hidden = makeDeps({ getActiveTab: () => Promise.resolve({ id: 1 }) });
    await expect(handleBackgroundMessage({ type: 'autofill/scan' }, hidden)).resolves.toMatchObject(
      {
        error: { code: 'PERMISSION_REQUIRED', message: PERMISSION_MESSAGE },
      },
    );
  });

  it('fills only on the page that was scanned', async () => {
    const report = {
      results: [{ ref: 'f1', status: 'filled' as const, message: '' }],
      blockedSubmissions: 0,
      newFields: 0,
      filledAt: '2026-10-22T00:00:00.000Z',
    };
    const deps = makeDeps({ sendToTab: vi.fn(() => Promise.resolve(ok(report))) });
    await expect(
      handleBackgroundMessage(
        {
          type: 'autofill/fill',
          pageUrl: 'https://careers.example.com/jobs/1#step2',
          instructions: [instruction],
        },
        deps,
      ),
    ).resolves.toEqual(ok(report));
    expect(deps.sendToTab).toHaveBeenCalledWith(
      3,
      { type: 'content/fill-form', instructions: [instruction] },
      0,
    );

    const moved = makeDeps();
    await expect(
      handleBackgroundMessage(
        {
          type: 'autofill/fill',
          pageUrl: 'https://other.example.com/apply',
          instructions: [instruction],
        },
        moved,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'PAGE_CHANGED' } });
    expect(moved.sendToTab).not.toHaveBeenCalled();
  });

  it('rejects fill requests that are malformed or empty', async () => {
    for (const message of [
      { type: 'autofill/fill', pageUrl: 'https://careers.example.com/jobs/1', instructions: [] },
      {
        type: 'autofill/fill',
        pageUrl: 'https://careers.example.com/jobs/1',
        instructions: [{ ...instruction, action: { type: 'click', selector: '#submit' } }],
      },
      { type: 'autofill/submit' },
    ]) {
      await expect(handleBackgroundMessage(message, makeDeps())).resolves.toMatchObject({
        ok: false,
        error: { code: 'INVALID_MESSAGE' },
      });
    }
  });
});
