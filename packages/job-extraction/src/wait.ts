import { SITE_ADAPTERS } from './adapters';
import { findJobPostingNodes } from './strategies/json-ld';
import { findDescriptionElement } from './strategies/dom';

export interface WaitOptions {
  /** Hard upper bound; the promise always settles by then. */
  timeoutMs: number;
  /** Minimum gap between readiness checks while the DOM is changing. */
  checkIntervalMs?: number;
  /** Page address; lets a site adapter decide when its job content is ready. */
  url?: string;
}

function safeUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** True once the page has enough content to extract from. */
export function isJobContentReady(doc: Document, url?: string): boolean {
  const parsed = url ? safeUrl(url) : null;
  const adapter = parsed ? SITE_ADAPTERS.find((a) => a.matches(parsed, doc)) : undefined;
  if (adapter?.isReady) return adapter.isReady(doc);
  if (findJobPostingNodes(doc).length > 0) return true;
  return doc.querySelector('h1') !== null && findDescriptionElement(doc) !== null;
}

/**
 * Waits for client-rendered job content using a single MutationObserver that is
 * throttled and always disconnected. Resolves `true` when content is ready and
 * `false` on timeout; never rejects and never polls on a timer loop.
 */
export function waitForJobContent(doc: Document, options: WaitOptions): Promise<boolean> {
  const ready = () => isJobContentReady(doc, options.url);
  if (ready()) return Promise.resolve(true);
  const interval = options.checkIntervalMs ?? 200;
  const view = doc.defaultView;
  if (!view || options.timeoutMs <= 0) return Promise.resolve(false);

  return new Promise((resolve) => {
    let pending: ReturnType<typeof setTimeout> | undefined;
    const finish = (ready: boolean) => {
      observer.disconnect();
      clearTimeout(deadline);
      if (pending !== undefined) clearTimeout(pending);
      resolve(ready);
    };
    const observer = new view.MutationObserver(() => {
      if (pending !== undefined) return;
      pending = setTimeout(() => {
        pending = undefined;
        if (ready()) finish(true);
      }, interval);
    });
    const deadline = setTimeout(() => finish(ready()), options.timeoutMs);
    observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true });
  });
}
