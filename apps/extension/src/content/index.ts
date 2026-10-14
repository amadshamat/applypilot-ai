import { contentRequestSchema, fail, ok } from '@applypilot/shared';
import { extractJob, waitForJobContent } from '@applypilot/job-extraction';

/**
 * Injected on demand (never declared in the manifest) when the user asks to
 * analyze the current page. It only reads the DOM: it does not modify the page,
 * submit forms, or contact any server.
 */
declare global {
  interface Window {
    __applyPilotContentReady?: boolean;
  }
}

if (!window.__applyPilotContentReady) {
  window.__applyPilotContentReady = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
    const parsed = contentRequestSchema.safeParse(message);
    if (!parsed.success) return false;

    const { waitMs } = parsed.data;
    waitForJobContent(document, { timeoutMs: waitMs })
      .then(() => sendResponse(ok(extractJob(document, location.href))))
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error);
        sendResponse(fail('EXTRACTION_FAILED', `Extraction failed: ${detail}`));
      });
    return true;
  });
}
