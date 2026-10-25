import { describe, expect, it } from 'vitest';
import { STORAGE_KEYS, type ApplicationRecord } from '@applypilot/shared';
import type { CloudItem, ItemChange } from '@applypilot/sync';
import { createApplication, updateJob } from '@applypilot/tracking';
import { fakeIdentity, fakeTokenFetch } from '../../test/cloud-fakes';
import { memoryStore, type KeyValueStore } from '../storage/storage-area';
import { CloudAuth } from './auth';
import { CloudSettingsRepository, LOCAL_TEST_CONNECTION as connection } from './connection';
import { ExtensionLocalData } from './local-data';
import { SyncRunner } from './runner';
import { SyncStateRepository, SyncStatusRepository } from './sync-store';

/** A small in-memory stand-in for the cloud API's sync endpoints, reached through fetch. */
class FakeApi {
  items = new Map<string, CloudItem>();
  epoch = 'epoch-1';
  t = 1_000_000;
  requests: string[] = [];

  fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input as string);
    if (url.pathname.startsWith('/oauth2/'))
      return fakeTokenFetch(connection.clientId)(input, init);
    this.requests.push(`${init?.method ?? 'GET'} ${url.pathname}`);
    if (!new Headers(init?.headers).get('Authorization')?.startsWith('Bearer ')) {
      return Response.json(
        { error: { code: 'UNAUTHORIZED', message: 'Sign in.' } },
        { status: 401 },
      );
    }
    if (url.pathname === '/v1/sync/changes') {
      const since = url.searchParams.get('since');
      const items = [...this.items.values()].filter(
        (i) => since === null || i.changedAt > Number(since) - 30_000,
      );
      return Response.json({ epoch: this.epoch, items, page: null, cursor: this.t });
    }
    if (url.pathname === '/v1/sync/push') {
      const body = JSON.parse(init?.body as string) as { epoch: string; changes: ItemChange[] };
      if (body.epoch !== this.epoch) {
        return Response.json(
          { error: { code: 'EPOCH_CHANGED', message: 'Reset.' } },
          { status: 409 },
        );
      }
      const results = body.changes.map((change) => {
        const key = `${change.kind}:${change.id}`;
        const current = this.items.get(key) ?? null;
        if ((current?.version ?? 0) !== change.baseVersion) {
          return { outcome: 'conflict', kind: change.kind, id: change.id, current };
        }
        this.t += 1000;
        const item = {
          kind: change.kind,
          id: change.id,
          data: change.data,
          version: (current?.version ?? 0) + 1,
          changedAt: this.t,
        } as CloudItem;
        this.items.set(key, item);
        return { outcome: 'applied', item };
      });
      return Response.json({ epoch: this.epoch, results });
    }
    return Response.json(
      { error: { code: 'NOT_FOUND', message: 'No such route.' } },
      { status: 404 },
    );
  }) as typeof fetch;
}

let n = 0;
const clock = { now: () => new Date('2026-10-20T12:00:00.000Z'), newId: () => `rec-${++n}` };
const record = (title: string): ApplicationRecord =>
  createApplication(
    {
      job: {
        title,
        company: 'Acme',
        location: '',
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

async function browser(api: FakeApi, { signIn = true, enabled = true } = {}) {
  const local = memoryStore();
  const session = memoryStore();
  const settings = new CloudSettingsRepository(local);
  await settings.save({ connection, syncEnabled: enabled });
  const auth = new CloudAuth({ session, identity: fakeIdentity(), fetch: api.fetch });
  if (signIn) await auth.signIn(connection);
  const runner = new SyncRunner({
    settings,
    auth,
    local: new ExtensionLocalData(local),
    state: new SyncStateRepository(local),
    status: new SyncStatusRepository(local),
    fetch: api.fetch,
  });
  const records = async () =>
    ((await local.get(STORAGE_KEYS.applications)) ?? []) as ApplicationRecord[];
  return { local, settings, auth, runner, records };
}

const setRecords = (store: KeyValueStore, records: ApplicationRecord[]) =>
  store.set(STORAGE_KEYS.applications, records);

describe('SyncRunner', () => {
  it('does nothing automatically until sync is turned on and the user is signed in', async () => {
    const api = new FakeApi();
    expect(await (await browser(api, { enabled: false })).runner.runIfEnabled()).toBeNull();
    expect(await (await browser(api, { signIn: false })).runner.runIfEnabled()).toBeNull();
    expect(api.requests).toEqual([]);
  });

  it('syncs two browsers through the cloud API', async () => {
    const api = new FakeApi();
    const a = await browser(api);
    const b = await browser(api);
    await setRecords(a.local, [record('Cloud Intern')]);
    expect((await a.runner.handle({ type: 'sync/run' })).ok).toBe(true);
    const status = await b.runner.runIfEnabled();
    expect(status).toMatchObject({ state: 'synced', conflicts: [] });
    expect(status?.lastSyncedAt).not.toBeNull();
    expect((await b.records()).map((r) => r.job.title)).toEqual(['Cloud Intern']);
  });

  it('shows conflicts with a readable title and resolves them', async () => {
    const api = new FakeApi();
    const a = await browser(api);
    const b = await browser(api);
    const original = record('Cloud Intern');
    await setRecords(a.local, [original]);
    await a.runner.handle({ type: 'sync/run' });
    await b.runner.handle({ type: 'sync/run' });
    await setRecords(a.local, [updateJob(original, { title: 'From A' }, clock.now())]);
    await setRecords(b.local, [updateJob(original, { title: 'From B' }, clock.now())]);
    await a.runner.handle({ type: 'sync/run' });
    const response = await b.runner.handle({ type: 'sync/run' });
    expect(response.ok && response.status.conflicts).toEqual([
      expect.objectContaining({
        kind: 'application',
        id: original.id,
        title: 'From B at Acme',
        fields: ['job.title'],
      }),
    ]);
    const resolved = await b.runner.handle({
      type: 'sync/resolve',
      kind: 'application',
      id: original.id,
      choice: 'cloud',
    });
    expect(resolved.ok && resolved.status.conflicts).toEqual([]);
    expect((await b.records())[0]?.job.title).toBe('From A');
  });

  it('pauses after a cloud reset and uploads again only when asked', async () => {
    const api = new FakeApi();
    const a = await browser(api);
    await setRecords(a.local, [record('Cloud Intern')]);
    await a.runner.handle({ type: 'sync/run' });
    api.items.clear();
    api.epoch = 'epoch-2';
    await setRecords(a.local, [...(await a.records()), record('New')]);
    const paused = await a.runner.handle({ type: 'sync/run' });
    expect(paused.ok && paused.status.state).toBe('cloud-reset');
    expect(api.items.size).toBe(0);
    const restarted = await a.runner.handle({ type: 'sync/restart' });
    expect(restarted.ok && restarted.status.state).toBe('synced');
    expect(api.items.size).toBe(2);
  });

  it('reports a signed-out browser instead of failing silently', async () => {
    const api = new FakeApi();
    const a = await browser(api, { signIn: false });
    const response = await a.runner.handle({ type: 'sync/run' });
    expect(response.ok && response.status.state).toBe('signed-out');
  });

  it('records network failures without touching local data', async () => {
    const api = new FakeApi();
    const a = await browser(api);
    await setRecords(a.local, [record('Cloud Intern')]);
    const offline = new SyncRunner({
      settings: a.settings,
      auth: a.auth,
      local: new ExtensionLocalData(a.local),
      state: new SyncStateRepository(a.local),
      status: new SyncStatusRepository(a.local),
      fetch: () => Promise.reject(new TypeError('offline')),
    });
    const response = await offline.handle({ type: 'sync/run' });
    expect(response.ok && response.status).toMatchObject({
      state: 'error',
      message: expect.stringContaining('Could not reach') as unknown,
    });
    expect(await a.records()).toHaveLength(1);
  });

  it('runs one operation at a time', async () => {
    const api = new FakeApi();
    const a = await browser(api);
    await setRecords(a.local, [record('Cloud Intern')]);
    const results = await Promise.all([
      a.runner.handle({ type: 'sync/run' }),
      a.runner.runIfEnabled(),
    ]);
    expect(results[0].ok).toBe(true);
    // The second run started after the first finished, so it found nothing to upload.
    expect(api.requests.filter((r) => r === 'POST /v1/sync/push')).toHaveLength(1);
  });

  it('forgets its bookkeeping on reset', async () => {
    const api = new FakeApi();
    const a = await browser(api);
    await a.runner.handle({ type: 'sync/run' });
    expect(await a.local.get(STORAGE_KEYS.syncState)).toBeDefined();
    const response = await a.runner.handle({ type: 'sync/reset' });
    expect(response.ok && response.status.state).toBe('off');
    expect(await a.local.get(STORAGE_KEYS.syncState)).toBeUndefined();
  });

  it('clears a "syncing" status left by an interrupted run when the worker starts', async () => {
    const api = new FakeApi();
    const a = await browser(api);
    const status = new SyncStatusRepository(a.local);
    await status.save({ ...(await status.load()), state: 'syncing' });
    await a.runner.recoverInterrupted();
    expect(await status.load()).toMatchObject({
      state: 'error',
      message: expect.stringContaining('interrupted') as unknown,
    });
    // A normal status is left alone.
    await a.runner.handle({ type: 'sync/run' });
    await a.runner.recoverInterrupted();
    expect((await status.load()).state).toBe('synced');
  });
});
