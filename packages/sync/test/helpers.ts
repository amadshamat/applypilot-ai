import {
  emptyProfileContent,
  PROFILE_VERSION,
  type ApplicationRecord,
  type Profile,
} from '@applypilot/shared';
import { createApplication, type Clock } from '@applypilot/tracking';
import {
  EpochChangedError,
  LocalDataChangedError,
  PROFILE_ITEM_ID,
  canonical,
  initialSyncState,
  type ChangesResponse,
  type CloudItem,
  type ItemChange,
  type LocalChanges,
  type LocalData,
  type LocalSnapshot,
  type PushResponse,
  type PushResult,
  type SyncState,
  type SyncStateStore,
  type SyncTransport,
} from '../src';

export function testClock(start = '2026-10-01T12:00:00.000Z'): Clock & { tick(ms?: number): void } {
  let t = Date.parse(start);
  let n = 0;
  return {
    now: () => new Date(t),
    newId: () => `rec-${++n}`,
    tick(ms = 60_000) {
      t += ms;
    },
  };
}

export function record(title: string, clock: Clock, company = 'Acme'): ApplicationRecord {
  return createApplication(
    {
      job: {
        title,
        company,
        location: 'Toronto, ON',
        url: '',
        jobKey: '',
        platform: 'manual',
        pay: '',
      },
      source: 'manual',
      status: 'saved',
      matchScore: null,
    },
    clock,
  );
}

export function profile(fullName: string, updatedAt = '2026-10-01T12:00:00.000Z'): Profile {
  const content = emptyProfileContent();
  return {
    ...content,
    personal: { ...content.personal, fullName },
    version: PROFILE_VERSION,
    updatedAt,
  };
}

/** An in-memory cloud with the same rules as the real API: versions, conflicts, tombstones, epochs. */
export class FakeCloud {
  items = new Map<string, CloudItem>();
  epoch = 'epoch-1';
  private t = 1_000_000;
  pushes = 0;

  transport(): SyncTransport {
    return {
      changes: (since) => Promise.resolve(this.changes(since)),
      push: (epoch, changes) => {
        try {
          return Promise.resolve(this.push(epoch, changes));
        } catch (e) {
          return Promise.reject(e instanceof Error ? e : new Error(String(e)));
        }
      },
    };
  }

  changes(since: number | null): ChangesResponse {
    const items = [...this.items.values()].filter(
      (i) => since === null || i.changedAt > since - 30_000,
    );
    return { epoch: this.epoch, items, page: null, cursor: this.t };
  }

  push(epoch: string, changes: ItemChange[]): PushResponse {
    this.pushes += 1;
    if (epoch !== this.epoch) throw new EpochChangedError('reset');
    const results: PushResult[] = changes.map((change) => {
      const key = `${change.kind}:${change.id}`;
      const current = this.items.get(key) ?? null;
      if ((current?.version ?? 0) !== change.baseVersion) {
        return { outcome: 'conflict', kind: change.kind, id: change.id, current };
      }
      const item = this.write(change);
      return { outcome: 'applied', item };
    });
    return { epoch: this.epoch, results };
  }

  /** A write from another device, straight into the cloud. */
  write(change: Omit<ItemChange, 'baseVersion'>): CloudItem {
    const key = `${change.kind}:${change.id}`;
    const version = (this.items.get(key)?.version ?? 0) + 1;
    this.t += 1000;
    const item = { ...change, version, changedAt: this.t } as CloudItem;
    this.items.set(key, item);
    return item;
  }

  reset() {
    this.items.clear();
    this.epoch = 'epoch-2';
  }
}

export class MemoryLocal implements LocalData {
  profile: Profile | null = null;
  profileReadable = true;
  applications: ApplicationRecord[] = [];
  backups: { reason: string; snapshot: LocalSnapshot }[] = [];
  /** Simulates the user editing data while a sync runs. */
  onWrite: (() => void) | null = null;

  read(): Promise<LocalSnapshot> {
    return Promise.resolve(
      structuredClone({
        profile: this.profile,
        profileReadable: this.profileReadable,
        applications: this.applications,
      }),
    );
  }

  write(changes: LocalChanges, readAt: LocalSnapshot): Promise<void> {
    this.onWrite?.();
    if (
      canonical(readAt.applications) !== canonical(this.applications) ||
      canonical(readAt.profile) !== canonical(this.profile)
    ) {
      return Promise.reject(new LocalDataChangedError('changed'));
    }
    if (changes.profile !== undefined) this.profile = changes.profile;
    const deletes = new Set(changes.deletes);
    let next = this.applications.filter((r) => !deletes.has(r.id));
    for (const record of changes.upserts) {
      next = next.some((r) => r.id === record.id)
        ? next.map((r) => (r.id === record.id ? record : r))
        : [record, ...next];
    }
    this.applications = next;
    return Promise.resolve();
  }

  backup(snapshot: LocalSnapshot, reason: string): Promise<void> {
    this.backups.push({ reason, snapshot });
    return Promise.resolve();
  }

  get(id: string) {
    return this.applications.find((r) => r.id === id);
  }
}

export function memoryState(initial: SyncState = initialSyncState()): SyncStateStore & {
  state: SyncState;
} {
  const holder = {
    state: initial,
    load: () => Promise.resolve(structuredClone(holder.state)),
    save: (s: SyncState) => {
      holder.state = structuredClone(s);
      return Promise.resolve();
    },
  };
  return holder;
}

export { PROFILE_ITEM_ID };
