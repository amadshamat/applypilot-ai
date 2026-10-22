import { contentRequestSchema, fail, ok, type FrameProbe } from '@applypilot/shared';
import { extractJob, waitForJobContent } from '@applypilot/job-extraction';
import { fillForm, scanForm } from '@applypilot/autofill';

/**
 * Injected on demand (never declared in the manifest) when the user asks to
 * analyze or autofill the current page, into the page and every frame Chrome
 * lets the extension read. It never contacts any server. Analyzing and
 * scanning only read the page. Filling changes only the fields the user
 * approved in the side panel, and never submits or advances the application.
 */
type MessageListener = Parameters<typeof chrome.runtime.onMessage.addListener>[0];

declare global {
  interface Window {
    __applyPilotListener?: MessageListener;
    /** Called by the background (scripting.executeScript) to find the frame that holds a job. */
    __applyPilotProbe?: () => FrameProbe;
  }
}

const isFrame = window !== window.top;

const listener: MessageListener = (message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const parsed = contentRequestSchema.safeParse(message);
  if (!parsed.success) return false;

  const request = parsed.data;
  if (request.type === 'content/scan-form') {
    try {
      sendResponse(ok(scanForm(document)));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      sendResponse(fail('SCAN_FAILED', `Could not read the form: ${detail}`));
    }
    return false;
  }
  if (request.type === 'content/fill-form') {
    fillForm(document, request.instructions)
      .then((report) => sendResponse(ok(report)))
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error);
        sendResponse(fail('FILL_FAILED', `Could not fill the form: ${detail}`));
      });
    return true;
  }

  const { waitMs, embedded = false } = request;
  waitForJobContent(document, { timeoutMs: waitMs, url: location.href })
    .then(() => sendResponse(ok(extractJob(document, location.href, { embedded }))))
    .catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      sendResponse(fail('EXTRACTION_FAILED', `Extraction failed: ${detail}`));
    });
  return true;
};

function probe(): FrameProbe {
  const result = extractJob(document, location.href, { embedded: isFrame });
  const { jobId, title } = result.job;
  return {
    url: location.href.slice(0, 4000),
    isJobPosting: result.isJobPosting,
    jobId: jobId.status === 'found' ? jobId.value.slice(0, 64) : null,
    title: title.status === 'found' ? title.value.slice(0, 300) : null,
  };
}

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
window.__applyPilotProbe = probe;
chrome.runtime.onMessage.addListener(listener);
