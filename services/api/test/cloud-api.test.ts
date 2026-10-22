import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CloudItem } from '@applypilot/sync';
import type { CloudLogEntry } from '../src/cloud/api';
import { startLocalDynamo, type LocalDynamo } from '../src/local/dynamo';
import { CLIENT_ID, ISSUER, errorCode, setupCloud, testProfile, testRecord } from './cloud-helpers';

let dynamo: LocalDynamo;
beforeAll(async () => {
  dynamo = await startLocalDynamo();
});
afterAll(async () => {
  await dynamo.close();
});

const itemOf = (body: unknown) => (body as { item: CloudItem }).item;

describe('authentication', () => {
  it('serves the health check without a token and nothing else', async () => {
    const { api } = setupCloud(dynamo);
    const health = await api({ method: 'GET', path: '/v1/health', headers: {}, body: '' });
    expect(health).toMatchObject({ status: 200, body: { ok: true, version: '0.6.0' } });
    const profile = await api({ method: 'GET', path: '/v1/profile', headers: {}, body: '' });
    expect(profile.status).toBe(401);
    expect(profile.headers).toEqual({ 'WWW-Authenticate': 'Bearer' });
  });

  it('refuses expired, foreign, ID, wrongly signed and unsigned tokens', async () => {
    const { api, signer, clock } = setupCloud(dynamo);
    const other = setupCloud(dynamo).signer; // a different key pair
    const sub = '7a2b4c6d-0000-4000-8000-000000000001';
    const cases = {
      expired: signer.accessToken({ sub }, { now: clock.now(), expiresIn: -60 }),
      wrongIssuer: signer.accessToken({ sub }, { overrides: { iss: `${ISSUER}x` } }),
      wrongClient: signer.accessToken({ sub }, { overrides: { client_id: 'someone-else' } }),
      idToken: signer.idToken({ sub, email: 'a@example.com' }),
      otherKey: other.accessToken({ sub }),
      algNone: (() => {
        const [, body] = signer.accessToken({ sub }).split('.');
        const head = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
        return `${head}.${body}.`;
      })(),
      tampered: (() => {
        const [head, , sig] = signer.accessToken({ sub }).split('.');
        const forged = Buffer.from(
          JSON.stringify({
            sub: 'victim',
            token_use: 'access',
            client_id: CLIENT_ID,
            iss: ISSUER,
            exp: 9999999999,
          }),
        ).toString('base64url');
        return `${head}.${forged}.${sig}`;
      })(),
    };
    for (const [name, token] of Object.entries(cases)) {
      const response = await api({
        method: 'GET',
        path: '/v1/account',
        headers: { authorization: `Bearer ${token}` },
        body: '',
      });
      expect(response.status, name).toBe(401);
    }
    const good = await api({
      method: 'GET',
      path: '/v1/account',
      headers: { authorization: `Bearer ${signer.accessToken({ sub })}` },
      body: '',
    });
    expect(good.status).toBe(200);
  });
});

describe('data isolation', () => {
  it('never lets one user read, change or delete another user’s items', async () => {
    const cloud = setupCloud(dynamo);
    const alice = cloud.user();
    const bob = cloud.user();
    const record = testRecord('Cloud Intern');
    const created = await alice.call('PUT', `/v1/applications/${record.id}`, {
      baseVersion: 0,
      data: record,
    });
    expect(created.status).toBe(200);
    await alice.call('PUT', '/v1/profile', { baseVersion: 0, data: testProfile('Alice') });

    expect((await bob.call('GET', `/v1/applications/${record.id}`)).status).toBe(404);
    expect((await bob.call('GET', '/v1/profile')).status).toBe(404);
    expect((await bob.call('GET', '/v1/applications')).body).toMatchObject({ items: [] });
    expect((await bob.call('GET', '/v1/sync/changes')).body).toMatchObject({ items: [] });
    expect((await bob.call('GET', '/v1/account/export')).body).toMatchObject({
      profile: null,
      applications: [],
    });
    // Bob writing the same id creates his own item; Alice's is untouched.
    await bob.call('PUT', `/v1/applications/${record.id}`, {
      baseVersion: 0,
      data: { ...record, job: { ...record.job, title: 'Bob’s copy' } },
    });
    await bob.call('POST', `/v1/applications/${record.id}/status`, { status: 'offer' });
    await bob.call('DELETE', '/v1/account');
    const aliceRecord = await alice.call('GET', `/v1/applications/${record.id}`);
    expect(itemOf(aliceRecord.body).data).toEqual(record);
    expect((await alice.call('GET', '/v1/profile')).status).toBe(200);
  });

  it('rejects a page token made for another user', async () => {
    const cloud = setupCloud(dynamo);
    const alice = cloud.user();
    const bob = cloud.user();
    const forged = Buffer.from(
      JSON.stringify({ k: { pk: `USER#${alice.sub}`, sk: 'APP#x', changedAt: 1 }, c: 1 }),
    ).toString('base64url');
    const response = await bob.call('GET', '/v1/sync/changes', undefined, { page: forged });
    expect(response.status).toBe(400);
    expect(errorCode(response)).toBe('INVALID_REQUEST');
  });
});

describe('applications and profile', () => {
  it('creates, reads, lists, updates with version checks and deletes', async () => {
    const { user } = setupCloud(dynamo);
    const u = user();
    const record = testRecord('Cloud Intern');
    const created = itemOf(
      (await u.call('PUT', `/v1/applications/${record.id}`, { baseVersion: 0, data: record })).body,
    );
    expect(created).toMatchObject({ kind: 'application', id: record.id, version: 1, data: record });

    const again = await u.call('PUT', `/v1/applications/${record.id}`, {
      baseVersion: 0,
      data: record,
    });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ error: { code: 'CONFLICT', current: { version: 1 } } });

    const renamed = { ...record, job: { ...record.job, title: 'Cloud Engineering Intern' } };
    const v2 = await u.call('PUT', `/v1/applications/${record.id}`, {
      baseVersion: 1,
      data: renamed,
    });
    expect(itemOf(v2.body).version).toBe(2);
    const stale = await u.call('PUT', `/v1/applications/${record.id}`, {
      baseVersion: 1,
      data: record,
    });
    expect(errorCode(stale)).toBe('CONFLICT');

    const list = await u.call('GET', '/v1/applications');
    expect((list.body as { items: CloudItem[] }).items.map((i) => i.data)).toEqual([renamed]);

    expect((await u.call('DELETE', `/v1/applications/${record.id}`)).status).toBe(400);
    const gone = await u.call('DELETE', `/v1/applications/${record.id}`, undefined, {
      baseVersion: '2',
    });
    expect(itemOf(gone.body)).toMatchObject({ version: 3, data: null });
    expect((await u.call('GET', `/v1/applications/${record.id}`)).status).toBe(404);
    expect((await u.call('GET', '/v1/applications')).body).toMatchObject({ items: [] });
    expect((await u.call('GET', '/v1/account')).body).toMatchObject({ applications: 0 });
  });

  it('changes status, notes and follow-ups with history kept', async () => {
    const { user, clock } = setupCloud(dynamo);
    const u = user();
    const record = testRecord('DevOps Intern');
    await u.call('PUT', `/v1/applications/${record.id}`, { baseVersion: 0, data: record });
    clock.tick(60_000);
    await u.call('POST', `/v1/applications/${record.id}/status`, { status: 'applied' });
    const noted = await u.call('POST', `/v1/applications/${record.id}/notes`, {
      text: 'Sent to Sam',
    });
    expect(noted.status).toBe(201);
    const noteId = (itemOf(noted.body).data as typeof record).notes[0]!.id;
    await u.call('PUT', `/v1/applications/${record.id}/follow-up`, {
      followUp: { due: '2026-10-29', note: 'Check in' },
    });
    const history = await u.call('GET', `/v1/applications/${record.id}/history`);
    expect(history.body).toMatchObject({
      status: 'applied',
      history: [{ status: 'saved' }, { status: 'applied', at: '2026-10-22T12:01:00.000Z' }],
    });
    expect((await u.call('DELETE', `/v1/applications/${record.id}/notes/nope`)).status).toBe(404);
    const removed = await u.call('DELETE', `/v1/applications/${record.id}/notes/${noteId}`);
    const final = itemOf(removed.body);
    expect(final.version).toBe(5);
    expect(final.data).toMatchObject({ notes: [], followUp: { due: '2026-10-29' } });

    expect(
      (await u.call('POST', `/v1/applications/${record.id}/status`, { status: 'hired' })).status,
    ).toBe(400);
    expect((await u.call('POST', '/v1/applications/missing/notes', { text: 'x' })).status).toBe(
      404,
    );
  });

  it('stores and replaces the profile', async () => {
    const { user } = setupCloud(dynamo);
    const u = user();
    expect((await u.call('GET', '/v1/profile')).status).toBe(404);
    const saved = await u.call('PUT', '/v1/profile', {
      baseVersion: 0,
      data: testProfile('Muhaid'),
    });
    expect(itemOf(saved.body)).toMatchObject({ kind: 'profile', version: 1 });
    expect(itemOf((await u.call('GET', '/v1/profile')).body).data).toMatchObject({
      personal: { fullName: 'Muhaid' },
    });
    const deleted = await u.call('DELETE', '/v1/profile', undefined, { baseVersion: '1' });
    expect(itemOf(deleted.body).data).toBeNull();
  });
});

describe('validation', () => {
  it('answers structured errors for bad input', async () => {
    const { user } = setupCloud(dynamo);
    const u = user();
    const record = testRecord('X');
    const checks: [string, Promise<{ status: number; body: unknown }>, number][] = [
      ['unknown path', u.call('GET', '/v1/nope'), 404],
      ['wrong method', u.call('PATCH', '/v1/profile'), 405],
      ['no json type', u.call('PUT', '/v1/profile', undefined), 400],
      [
        'bad json',
        u.call('PUT', '/v1/profile', undefined, {}, { 'content-type': 'application/json' }),
        400,
      ],
      ['invalid profile', u.call('PUT', '/v1/profile', { baseVersion: 0, data: { name: 1 } }), 400],
      [
        'id mismatch',
        u.call('PUT', '/v1/applications/other-id', { baseVersion: 0, data: record }),
        400,
      ],
      ['unsafe id', u.call('GET', '/v1/applications/a%23b'), 400],
      ['bad cursor', u.call('GET', '/v1/sync/changes', undefined, { since: '-5' }), 400],
      ['empty push', u.call('POST', '/v1/sync/push', { epoch: 'x', changes: [] }), 400],
    ];
    for (const [name, promise, status] of checks) {
      const response = await promise;
      expect(response.status, name).toBe(status);
      expect(response.body, name).toMatchObject({
        error: {
          code: expect.any(String) as unknown,
          message: expect.any(String) as unknown,
          requestId: expect.any(String) as unknown,
        },
      });
    }
  });

  it('refuses oversized requests and items', async () => {
    const { user } = setupCloud(dynamo, { maxBodyBytes: 2000 });
    const u = user();
    const big = { ...testProfile('M'), summary: 'x'.repeat(1990) };
    const response = await u.call('PUT', '/v1/profile', { baseVersion: 0, data: big });
    expect(response.status).toBe(413);
  });
});

describe('sync endpoints', () => {
  it('pushes with conflict checks and pages changes since a cursor', async () => {
    const { user, clock } = setupCloud(dynamo);
    const u = user();
    const account = (await u.call('GET', '/v1/account')).body as { epoch: string };
    const records = Array.from({ length: 60 }, (_, i) => testRecord(`Job ${i}`));
    for (let i = 0; i < records.length; i += 50) {
      const pushed = await u.call('POST', '/v1/sync/push', {
        epoch: account.epoch,
        changes: records
          .slice(i, i + 50)
          .map((data) => ({ kind: 'application', id: data.id, baseVersion: 0, data })),
      });
      expect(pushed.status).toBe(200);
    }
    // First sync: everything, in two pages.
    const first = await u.call('GET', '/v1/sync/changes');
    const firstBody = first.body as {
      items: CloudItem[];
      page: string | null;
      cursor: number | null;
    };
    expect(firstBody.items).toHaveLength(50);
    expect(firstBody.cursor).toBeNull();
    const second = await u.call('GET', '/v1/sync/changes', undefined, { page: firstBody.page! });
    const secondBody = second.body as { items: CloudItem[]; page: string | null; cursor: number };
    expect(secondBody.items).toHaveLength(10);
    expect(secondBody.page).toBeNull();

    // Later: only what changed (plus the short overlap window).
    clock.tick(120_000);
    const target = records[3]!;
    const conflictPush = await u.call('POST', '/v1/sync/push', {
      epoch: account.epoch,
      changes: [
        { kind: 'application', id: target.id, baseVersion: 1, data: { ...target, matchScore: 90 } },
        { kind: 'application', id: records[4]!.id, baseVersion: 7, data: records[4] },
      ],
    });
    expect(conflictPush.body).toMatchObject({
      results: [
        { outcome: 'applied', item: { version: 2 } },
        { outcome: 'conflict', id: records[4]!.id, current: { version: 1 } },
      ],
    });
    const since = await u.call('GET', '/v1/sync/changes', undefined, {
      since: String(secondBody.cursor + 60_000),
    });
    expect((since.body as { items: CloudItem[] }).items.map((i) => i.id)).toEqual([target.id]);
  });

  it('refuses pushes after the cloud data was deleted, and starts a new epoch', async () => {
    const { user } = setupCloud(dynamo);
    const u = user();
    const { epoch } = (await u.call('GET', '/v1/account')).body as { epoch: string };
    const record = testRecord('Cloud Intern');
    await u.call('PUT', `/v1/applications/${record.id}`, { baseVersion: 0, data: record });
    const wiped = await u.call('DELETE', '/v1/account/data');
    expect(wiped.body).toMatchObject({ deleted: 1 });
    const next = (wiped.body as { epoch: string }).epoch;
    expect(next).not.toBe(epoch);
    const push = await u.call('POST', '/v1/sync/push', {
      epoch,
      changes: [{ kind: 'application', id: record.id, baseVersion: 0, data: record }],
    });
    expect(push.status).toBe(409);
    expect(errorCode(push)).toBe('EPOCH_CHANGED');
    expect((await u.call('GET', '/v1/sync/changes')).body).toMatchObject({
      epoch: next,
      items: [],
    });
  });
});

describe('accounts', () => {
  it('exports everything, then deletes the account and every item', async () => {
    const cloud = setupCloud(dynamo);
    const u = cloud.user();
    const record = testRecord('Cloud Intern');
    await u.call('PUT', `/v1/applications/${record.id}`, { baseVersion: 0, data: record });
    await u.call('PUT', '/v1/profile', { baseVersion: 0, data: testProfile('Muhaid') });
    const exported = await u.call('GET', '/v1/account/export');
    expect(exported.body).toMatchObject({
      format: 'applypilot-cloud-export',
      profile: { personal: { fullName: 'Muhaid' } },
      applications: [record],
    });
    const closed = await u.call('DELETE', '/v1/account');
    expect(closed.body).toMatchObject({ accountDeleted: true, deleted: 2 });
    expect(cloud.deleted).toEqual([u.sub]);
    const { Count } = await dynamo.doc.send(
      new (await import('@aws-sdk/lib-dynamodb')).QueryCommand({
        TableName: dynamo.tableName,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': `USER#${u.sub}` },
      }),
    );
    expect(Count).toBe(0);
  });

  it('leaves account deletion to the account function', async () => {
    const { user } = setupCloud(dynamo, { functions: ['data'] });
    const u = user();
    expect((await u.call('DELETE', '/v1/account')).status).toBe(405);
    expect((await u.call('DELETE', '/v1/account/data')).status).toBe(404);
  });
});

describe('abuse protection and logging', () => {
  it('rate-limits each user separately and says when to retry', async () => {
    const { user } = setupCloud(dynamo, { requestsPerMinute: 3 });
    const a = user();
    const b = user();
    for (let i = 0; i < 3; i++) expect((await a.call('GET', '/v1/account')).status).toBe(200);
    const limited = await a.call('GET', '/v1/account');
    expect(limited.status).toBe(429);
    expect(limited.headers).toEqual({ 'Retry-After': '60' });
    expect((await b.call('GET', '/v1/account')).status).toBe(200);
  });

  it('logs route templates and a hashed user, never ids, bodies or tokens', async () => {
    const entries: CloudLogEntry[] = [];
    const { user } = setupCloud(dynamo, { log: (e) => entries.push(e) });
    const u = user();
    const record = testRecord('Secret Title');
    await u.call('PUT', `/v1/applications/${record.id}`, { baseVersion: 0, data: record });
    await u.call('GET', '/v1/nope');
    const text = JSON.stringify(entries);
    expect(entries[0]).toMatchObject({ route: 'PUT /v1/applications/{id}', status: 200 });
    expect(entries[0]?.user).toMatch(/^[0-9a-f]{12}$/);
    expect(entries[1]).toMatchObject({ status: 404, code: 'NOT_FOUND' });
    for (const secret of [record.id, 'Secret Title', u.sub, u.token]) {
      expect(text).not.toContain(secret);
    }
  });
});
