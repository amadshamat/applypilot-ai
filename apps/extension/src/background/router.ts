import {
  backgroundRequestSchema,
  fail,
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
  injectContentScript(tabId: number): Promise<void>;
  sendToTab(tabId: number, message: unknown): Promise<unknown>;
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
    reply = await deps.sendToTab(tab.id, { type: 'content/extract-job', waitMs: CONTENT_WAIT_MS });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail('EXTRACTION_FAILED', `The page did not respond: ${message}`);
  }

  // The content script runs inside an untrusted page, so its reply is validated too.
  const response = responseSchemas['content/extract-job'].safeParse(reply);
  if (!response.success)
    return fail('EXTRACTION_FAILED', 'The page returned an unexpected result.');
  if (response.data.ok && (await deps.shouldCache())) {
    await deps.cache.set(tab.id, response.data.data);
  }
  return response.data;
}
