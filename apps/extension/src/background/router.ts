import {
  backgroundRequestSchema,
  fail,
  frameProbeSchema,
  isSameJobPage,
  jobExtractionResultSchema,
  ok,
  responseSchemas,
  type BackgroundRequest,
  type JobExtractionResult,
  type Result,
} from '@applypilot/shared';

export interface ActiveTab {
  id: number;
  /** Only present when the extension has access to the tab (activeTab grant or host permission). */
  url?: string;
}

/** Everything the router needs from Chrome, injected so it can be unit tested. */
export interface BackgroundDeps {
  version: string;
  getActiveTab(): Promise<ActiveTab | null>;
  /** Injects the content script into the page and every frame Chrome allows. */
  injectContentScript(tabId: number): Promise<void>;
  /** Sends to one frame of the tab; frame 0 is the page itself. */
  sendToTab(tabId: number, message: unknown, frameId: number): Promise<unknown>;
  /** Asks every readable frame what it shows; unvalidated, one entry per frame. */
  probeFrames(tabId: number): Promise<{ frameId: number; result: unknown }[]>;
  cache: {
    get(tabId: number): Promise<unknown>;
    set(tabId: number, result: JobExtractionResult): Promise<void>;
  };
  shouldCache(): Promise<boolean>;
}

/** How long the content script may wait for client-rendered job content. */
export const CONTENT_WAIT_MS = 4_000;

const RESTRICTED_URL = /^(chrome|chrome-extension|edge|about|devtools|view-source|chrome-search):/i;
const WEB_STORE = /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/i;

export const PERMISSION_MESSAGE =
  'ApplyPilot needs your permission to read this page. Click the ApplyPilot icon in the Chrome toolbar while this tab is open, then try again.';

function isPermissionError(message: string): boolean {
  return /cannot access|permission|host|activeTab|not allowed/i.test(message);
}

/**
 * Handles one message from an extension page. Unknown or malformed messages are
 * rejected; every reply matches the response schema for its request type.
 */
export async function handleBackgroundMessage(
  raw: unknown,
  deps: BackgroundDeps,
): Promise<Result<unknown>> {
  const parsed = backgroundRequestSchema.safeParse(raw);
  if (!parsed.success) return fail('INVALID_MESSAGE', 'Unsupported or malformed request.');
  const request: BackgroundRequest = parsed.data;
  switch (request.type) {
    case 'app/ping':
      return ok({ version: deps.version });
    case 'job/get-cached':
      return ok(await cachedFor(request.tabId, deps));
    case 'job/extract-active-tab':
      return extractActiveTab(deps);
  }
}

/**
 * The tab's earlier analysis, unless the tab now shows a different job. Indeed
 * switches jobs without reloading the page (only the address changes), so the
 * cached result is compared with the tab's current address.
 */
async function cachedFor(tabId: number, deps: BackgroundDeps): Promise<JobExtractionResult | null> {
  const cached = jobExtractionResultSchema.safeParse(await deps.cache.get(tabId));
  if (!cached.success) return null;
  const tab = await deps.getActiveTab();
  if (tab?.id === tabId && tab.url && !isSameJobPage(cached.data.pageUrl, tab.url)) return null;
  return cached.data;
}

async function extractActiveTab(deps: BackgroundDeps): Promise<Result<JobExtractionResult>> {
  const tab = await deps.getActiveTab();
  if (!tab) return fail('NO_ACTIVE_TAB', 'No active tab was found in this window.');
  if (!tab.url) return fail('PERMISSION_REQUIRED', PERMISSION_MESSAGE);
  if (RESTRICTED_URL.test(tab.url) || WEB_STORE.test(tab.url) || !/^https?:/i.test(tab.url)) {
    return fail(
      'UNSUPPORTED_PAGE',
      'ApplyPilot can only analyze regular web pages (http or https).',
    );
  }

  try {
    await deps.injectContentScript(tab.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return isPermissionError(message)
      ? fail('PERMISSION_REQUIRED', PERMISSION_MESSAGE)
      : fail('EXTRACTION_FAILED', `Could not read the page: ${message}`);
  }

  let reply: unknown;
  try {
    reply = await deps.sendToTab(
      tab.id,
      { type: 'content/extract-job', waitMs: CONTENT_WAIT_MS },
      0,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail('EXTRACTION_FAILED', `The page did not respond: ${message}`);
  }

  // The content script runs inside an untrusted page, so its reply is validated too.
  const response = responseSchemas['content/extract-job'].safeParse(reply);
  if (!response.success)
    return fail('EXTRACTION_FAILED', 'The page returned an unexpected result.');
  let result = response.data;
  if (result.ok && !result.data.isJobPosting) {
    // The job may be inside a frame the page itself cannot read (another origin).
    const fromFrame = await readJobFrame(tab.id, tab.url, result.data, deps);
    if (fromFrame) result = ok(fromFrame);
  }
  if (result.ok && (await deps.shouldCache())) {
    await deps.cache.set(tab.id, result.data);
  }
  return result;
}

/** How long a details frame may take to finish loading once it is found. */
export const FRAME_WAIT_MS = 1_500;

/**
 * Reads the job from a frame when the page itself found none: each frame's
 * content script reports what it shows, and only a frame showing the selected
 * job (same job id) is read. With no selection known, a frame is used only if
 * it is the one frame showing a job, so a frame can never stand in for a
 * different job than the one the user picked.
 */
async function readJobFrame(
  tabId: number,
  tabUrl: string,
  page: JobExtractionResult,
  deps: BackgroundDeps,
): Promise<JobExtractionResult | null> {
  let probes: { frameId: number; result: unknown }[];
  try {
    probes = await deps.probeFrames(tabId);
  } catch {
    return null;
  }
  const jobs = probes.flatMap(({ frameId, result }) => {
    const probe = frameProbeSchema.safeParse(result);
    return frameId !== 0 && probe.success && probe.data.isJobPosting
      ? [{ frameId, ...probe.data }]
      : [];
  });
  const selected = page.diagnostics?.selectedJobId ?? null;
  const match = selected
    ? jobs.find((j) => j.jobId?.toLowerCase() === selected.toLowerCase())
    : jobs.length === 1
      ? jobs[0]
      : undefined;
  if (!match) return null;

  let reply: unknown;
  try {
    reply = await deps.sendToTab(
      tabId,
      { type: 'content/extract-job', waitMs: FRAME_WAIT_MS, embedded: true },
      match.frameId,
    );
  } catch {
    return null;
  }
  const response = responseSchemas['content/extract-job'].safeParse(reply);
  if (!response.success || !response.data.ok || !response.data.data.isJobPosting) return null;
  const frame = response.data.data;
  const frameJobId = frame.job.jobId.status === 'found' ? frame.job.jobId.value : null;
  if (selected && frameJobId?.toLowerCase() !== selected.toLowerCase()) return null;

  let origin = 'another address';
  try {
    origin = new URL(match.url).origin;
  } catch {
    // keep the generic wording
  }
  return {
    ...frame,
    // The analysis belongs to the tab the user is looking at.
    pageUrl: tabUrl,
    diagnostics: {
      scope: 'selected-job',
      selectedJobId: selected ?? frameJobId,
      via: 'frame',
      checks: [
        ...(page.diagnostics?.checks.filter((c) => c.id === 'selected-job') ?? []),
        {
          id: 'details-panel',
          status: 'pass',
          message: `Read from inside the job details frame (${origin}). Other results were ignored.`,
        },
        ...(selected
          ? [
              {
                id: 'panel-match',
                status: 'pass' as const,
                message: 'The details frame shows the selected job id.',
              },
            ]
          : []),
        ...(frame.diagnostics?.checks.filter(
          (c) => !['selected-job', 'details-panel', 'panel-match'].includes(c.id),
        ) ?? []),
      ],
    },
  };
}
