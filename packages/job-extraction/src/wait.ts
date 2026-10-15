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

function adapterFor(doc: Document, url?: string) {
  const parsed = url ? safeUrl(url) : null;
  const adapter = parsed ? SITE_ADAPTERS.find((a) => a.matches(parsed, doc)) : undefined;
  return parsed && adapter ? { url: parsed, adapter } : null;
}

/** True once the page has enough content to extract from. */
export function isJobContentReady(doc: Document, url?: string): boolean {
  const match = adapterFor(doc, url);
  if (match?.adapter.isReady) return match.adapter.isReady(doc, match.url);
  if (findJobPostingNodes(doc).length > 0) return true;
  return doc.querySelector('h1') !== null && findDescriptionElement(doc) !== null;
}

/**
 * Waits for client-rendered job content using MutationObservers that are
 * throttled and always disconnected. Same-origin frames an adapter reads from
 * (Indeed's job details frame) are observed too, and a frame finishing loading
 * also triggers a check. Resolves `true` when content is ready and `false` on
 * timeout; never rejects and never polls on a timer loop.
 */
export function waitForJobContent(doc: Document, options: WaitOptions): Promise<boolean> {
  const ready = () => isJobContentReady(doc, options.url);
  if (ready()) return Promise.resolve(true);
  const interval = options.checkIntervalMs ?? 200;
  const view = doc.defaultView;
  if (!view || options.timeoutMs <= 0) return Promise.resolve(false);
  const match = adapterFor(doc, options.url);
  const frames = (): Document[] => match?.adapter.watchedDocuments?.(doc) ?? [];

  return new Promise((resolve) => {
    let pending: ReturnType<typeof setTimeout> | undefined;
    const observed = new Set<Document>();
    const observers: MutationObserver[] = [];
    const finish = (ready: boolean) => {
      for (const observer of observers) observer.disconnect();
      doc.removeEventListener('load', schedule, true);
      clearTimeout(deadline);
      if (pending !== undefined) clearTimeout(pending);
      resolve(ready);
    };
    const observe = (target: Document) => {
      if (observed.has(target)) return;
      observed.add(target);
      const Observer = target.defaultView?.MutationObserver ?? view.MutationObserver;
      const observer = new Observer(schedule);
      observer.observe(target.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      observers.push(observer);
    };
    function schedule() {
      if (pending !== undefined) return;
      pending = setTimeout(() => {
        pending = undefined;
        // A frame may have loaded a new document since the last check.
        for (const frameDoc of frames()) observe(frameDoc);
        if (ready()) finish(true);
      }, interval);
    }
    const deadline = setTimeout(() => finish(ready()), options.timeoutMs);
    observe(doc);
    for (const frameDoc of frames()) observe(frameDoc);
    // Frame load events do not bubble, but they pass through the capture phase.
    doc.addEventListener('load', schedule, true);
  });
}
