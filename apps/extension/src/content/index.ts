import { contentRequestSchema, fail, ok } from '@applypilot/shared';
import { extractJob, waitForJobContent } from '@applypilot/job-extraction';

/**
 * Injected on demand (never declared in the manifest) when the user asks to
 * analyze the current page. It only reads the DOM: it does not modify the page,
 * submit forms, or contact any server.
 */
type MessageListener = Parameters<typeof chrome.runtime.onMessage.addListener>[0];

declare global {
  interface Window {
    __applyPilotListener?: MessageListener;
  }
}

const listener: MessageListener = (message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const parsed = contentRequestSchema.safeParse(message);
  if (!parsed.success) return false;

  const { waitMs } = parsed.data;
  waitForJobContent(document, { timeoutMs: waitMs, url: location.href })
    .then(() => sendResponse(ok(extractJob(document, location.href))))
    .catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      sendResponse(fail('EXTRACTION_FAILED', `Extraction failed: ${detail}`));
    });
  return true;
};

// Each injection replaces the previous listener, so the page always answers
// with the newest code (for example after the extension is updated) and never
// answers twice.
const previous = window.__applyPilotListener;
if (previous) {
  try {
    chrome.runtime.onMessage.removeListener(previous);
  } catch {
    // The previous copy belonged to an unloaded extension version; nothing to remove.
  }
}
window.__applyPilotListener = listener;
chrome.runtime.onMessage.addListener(listener);
