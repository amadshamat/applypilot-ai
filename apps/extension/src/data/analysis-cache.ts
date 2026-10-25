import type { KeyValueStore } from '../storage/storage-area';

/**
 * Page analyses the service worker keeps in chrome.storage.session, one per
 * tab, so reopening the panel shows the last result without re-reading the page.
 */
export const ANALYSIS_CACHE_PREFIX = 'job-analysis:';

export const analysisCacheKey = (tabId: number) => `${ANALYSIS_CACHE_PREFIX}${tabId}`;

/** Removes every cached analysis. Returns how many were removed. */
export async function clearCachedAnalyses(session: KeyValueStore): Promise<number> {
  const keys = Object.keys(await session.getAll()).filter((key) =>
    key.startsWith(ANALYSIS_CACHE_PREFIX),
  );
  for (const key of keys) await session.remove(key);
  return keys.length;
}
