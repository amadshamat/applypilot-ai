/**
 * Minimal key-value storage interface. Production code uses chrome.storage;
 * tests use the in-memory implementation, so storage logic is testable
 * without a browser.
 */
export interface KeyValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  getAll(): Promise<Record<string, unknown>>;
  clear(): Promise<void>;
  /** Calls `listener` with the new value whenever `key` changes. Returns an unsubscribe function. */
  subscribe(key: string, listener: (value: unknown) => void): () => void;
}

export function chromeStore(area: 'local' | 'session'): KeyValueStore {
  const storage = chrome.storage[area];
  return {
    async get(key) {
      const items = await storage.get(key);
      return items[key];
    },
    set: (key, value) => storage.set({ [key]: value }),
    remove: (key) => storage.remove(key),
    getAll: () => storage.get(null),
    clear: () => storage.clear(),
    subscribe(key, listener) {
      const handler = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
        const change = changes[key];
        if (areaName === area && change) listener(change.newValue);
      };
      chrome.storage.onChanged.addListener(handler);
      return () => chrome.storage.onChanged.removeListener(handler);
    },
  };
}

export function memoryStore(initial: Record<string, unknown> = {}): KeyValueStore {
  const data = new Map(Object.entries(structuredClone(initial)));
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  const notify = (key: string, value: unknown) => listeners.get(key)?.forEach((l) => l(value));
  return {
    get: (key) => Promise.resolve(structuredClone(data.get(key))),
    set(key, value) {
      data.set(key, structuredClone(value));
      notify(key, value);
      return Promise.resolve();
    },
    remove(key) {
      data.delete(key);
      notify(key, undefined);
      return Promise.resolve();
    },
    getAll: () => Promise.resolve(structuredClone(Object.fromEntries(data))),
    clear() {
      const keys = [...data.keys()];
      data.clear();
      keys.forEach((key) => notify(key, undefined));
      return Promise.resolve();
    },
    subscribe(key, listener) {
      const set = listeners.get(key) ?? new Set();
      set.add(listener);
      listeners.set(key, set);
      return () => set.delete(listener);
    },
  };
}
