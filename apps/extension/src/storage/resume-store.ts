import { resumeVersionMetaSchema, type ResumeVersionMeta } from '@applypilot/shared';

/**
 * Uploaded resume files, kept in IndexedDB because chrome.storage cannot hold
 * binary data efficiently. Each record holds the original file, unmodified,
 * next to its extracted text and parsed draft.
 */

const DB_NAME = 'applypilot';
const DB_VERSION = 1;
const STORE = 'resumes';

interface ResumeRecord {
  meta: ResumeVersionMeta;
  /** The original file's bytes. Stored as an ArrayBuffer, which every IndexedDB implementation can clone. */
  bytes: ArrayBuffer;
}

export interface ResumeStore {
  list(): Promise<ResumeVersionMeta[]>;
  getFile(id: string): Promise<Blob | null>;
  put(meta: ResumeVersionMeta, file: Blob): Promise<void>;
  update(meta: ResumeVersionMeta): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export function indexedDbResumeStore(factory: IDBFactory = indexedDB): ResumeStore {
  let opening: Promise<IDBDatabase> | null = null;
  const open = () => {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE))
          req.result.createObjectStore(STORE, { keyPath: 'meta.id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        opening = null;
        reject(req.error ?? new Error('Could not open IndexedDB'));
      };
    });
    return opening;
  };

  const withStore = async <T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => Promise<T> | T,
  ) => {
    const db = await open();
    const tx = db.transaction(STORE, mode);
    const result = await run(tx.objectStore(STORE));
    await done(tx);
    return result;
  };

  return {
    async list() {
      const records = await withStore('readonly', (store) =>
        request(store.getAll() as IDBRequest<ResumeRecord[]>),
      );
      return records
        .map((record) => resumeVersionMetaSchema.safeParse(record.meta))
        .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
        .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    },
    async getFile(id) {
      const record = await withStore('readonly', (store) =>
        request(store.get(id) as IDBRequest<ResumeRecord | undefined>),
      );
      return record ? new Blob([record.bytes], { type: record.meta.mimeType }) : null;
    },
    async put(meta, file) {
      const record: ResumeRecord = {
        meta: resumeVersionMetaSchema.parse(meta),
        bytes: await file.arrayBuffer(),
      };
      await withStore('readwrite', (store) => request(store.put(record)));
    },
    async update(meta) {
      const valid = resumeVersionMetaSchema.parse(meta);
      await withStore('readwrite', async (store) => {
        const existing = await request(store.get(valid.id) as IDBRequest<ResumeRecord | undefined>);
        if (!existing) throw new Error('That resume no longer exists.');
        await request(store.put({ ...existing, meta: valid }));
      });
    },
    async remove(id) {
      await withStore('readwrite', (store) => request(store.delete(id)));
    },
    async clear() {
      await withStore('readwrite', (store) => request(store.clear()));
    },
  };
}

/** In-memory implementation for component tests. */
export function memoryResumeStore(): ResumeStore {
  const records = new Map<string, { meta: ResumeVersionMeta; file: Blob }>();
  return {
    list: () =>
      Promise.resolve(
        [...records.values()]
          .map((record) => structuredClone(record.meta))
          .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)),
      ),
    getFile: (id) => Promise.resolve(records.get(id)?.file ?? null),
    put(meta, file) {
      records.set(meta.id, { meta: resumeVersionMetaSchema.parse(meta), file });
      return Promise.resolve();
    },
    update(meta) {
      const existing = records.get(meta.id);
      if (!existing) return Promise.reject(new Error('That resume no longer exists.'));
      records.set(meta.id, { ...existing, meta: resumeVersionMetaSchema.parse(meta) });
      return Promise.resolve();
    },
    remove(id) {
      records.delete(id);
      return Promise.resolve();
    },
    clear() {
      records.clear();
      return Promise.resolve();
    },
  };
}
