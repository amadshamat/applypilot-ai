import {
  MAX_APPLICATIONS,
  STORAGE_KEYS,
  applicationRecordSchema,
  type ApplicationRecord,
} from '@applypilot/shared';
import type { KeyValueStore } from './storage-area';

export interface ApplicationsLoad {
  records: ApplicationRecord[];
  /**
   * Stored entries that fail validation (for example written by a future
   * version). They are kept as they are and written back on every save, so
   * nothing the user tracked is ever dropped silently.
   */
  unreadable: unknown[];
}

/**
 * The user's tracked applications in chrome.storage.local, as one list.
 * Every record is validated on read and on write.
 */
export class ApplicationsRepository {
  constructor(private readonly store: KeyValueStore) {}

  async load(): Promise<ApplicationsLoad> {
    return ApplicationsRepository.interpret(await this.store.get(STORAGE_KEYS.applications));
  }

  /** Replaces the record with the same id, or adds it. */
  async upsert(record: ApplicationRecord): Promise<ApplicationRecord[]> {
    const valid = applicationRecordSchema.parse(record);
    const { records, unreadable } = await this.load();
    const exists = records.some((r) => r.id === valid.id);
    if (!exists && records.length + unreadable.length >= MAX_APPLICATIONS) {
      throw new Error(
        `You are tracking ${MAX_APPLICATIONS} applications, the most ApplyPilot keeps. Export and delete old ones first.`,
      );
    }
    const next = exists ? records.map((r) => (r.id === valid.id ? valid : r)) : [valid, ...records];
    await this.store.set(STORAGE_KEYS.applications, [...next, ...unreadable]);
    return next;
  }

  async remove(id: string): Promise<ApplicationRecord[]> {
    const { records, unreadable } = await this.load();
    const next = records.filter((r) => r.id !== id);
    await this.store.set(STORAGE_KEYS.applications, [...next, ...unreadable]);
    return next;
  }

  subscribe(listener: (load: ApplicationsLoad) => void): () => void {
    return this.store.subscribe(STORAGE_KEYS.applications, (value) =>
      listener(ApplicationsRepository.interpret(value)),
    );
  }

  static interpret(raw: unknown): ApplicationsLoad {
    if (!Array.isArray(raw)) return { records: [], unreadable: [] };
    const records: ApplicationRecord[] = [];
    const unreadable: unknown[] = [];
    for (const item of raw) {
      const parsed = applicationRecordSchema.safeParse(item);
      if (parsed.success) records.push(parsed.data);
      else unreadable.push(item);
    }
    return { records, unreadable };
  }
}
