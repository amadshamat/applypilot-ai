import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addNote, setStatus, updateJob } from '@applypilot/tracking';
import { CloudClient, CloudClientError, SyncEngine } from '@applypilot/sync';
import {
  MemoryLocal,
  memoryState,
  profile,
  record,
  testClock,
} from '../../../packages/sync/test/helpers';
import { startLocalCloud, type LocalCloud } from '../src/local/cloud-server';

/**
 * End to end on this machine: the OAuth sign-in flow against the Cognito
 * stand-in, then real sync between two devices through HTTP, the cloud API,
 * and the DynamoDB stand-in.
 */

const REDIRECT = `https://${'a'.repeat(32)}.chromiumapp.org/`;

let cloud: LocalCloud;
beforeAll(async () => {
  cloud = await startLocalCloud();
});
afterAll(async () => {
  await cloud.close();
});

function pkce() {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function authorizeParams(challenge: string, state = 'state-123') {
  return new URLSearchParams({
    response_type: 'code',
    client_id: cloud.auth.clientId,
    redirect_uri: REDIRECT,
    scope: 'openid email',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
}

async function login(
  email: string,
  password: string,
  mode: 'signin' | 'signup',
  challenge: string,
) {
  const form = authorizeParams(challenge);
  form.set('email', email);
  form.set('password', password);
  form.set('mode', mode);
  return fetch(`${cloud.url}/login`, {
    method: 'POST',
    body: form,
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

async function token(form: Record<string, string>) {
  const response = await fetch(`${cloud.url}/oauth2/token`, {
    method: 'POST',
    body: new URLSearchParams({ client_id: cloud.auth.clientId, ...form }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, string> };
}

async function signUp(email: string) {
  const { verifier, challenge } = pkce();
  const response = await login(email, 'correct horse battery', 'signup', challenge);
  const location = new URL(response.headers.get('location') ?? '');
  const tokens = await token({
    grant_type: 'authorization_code',
    code: location.searchParams.get('code') ?? '',
    redirect_uri: REDIRECT,
    code_verifier: verifier,
  });
  return tokens.body;
}

describe('Cognito stand-in', () => {
  it('shows a sign-in page only for a valid PKCE request', async () => {
    const { challenge } = pkce();
    const page = await fetch(`${cloud.url}/oauth2/authorize?${authorizeParams(challenge)}`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(await page.text()).toContain('Create account');

    const bad = authorizeParams(challenge);
    bad.set('redirect_uri', 'https://evil.example/');
    expect((await fetch(`${cloud.url}/oauth2/authorize?${bad}`)).status).toBe(400);
    const plain = authorizeParams(challenge);
    plain.delete('code_challenge_method');
    expect((await fetch(`${cloud.url}/oauth2/authorize?${plain}`)).status).toBe(400);
  });

  it('signs up, exchanges the code once with the right verifier, refreshes and revokes', async () => {
    const { verifier, challenge } = pkce();
    const short = await login('new@example.com', 'short', 'signup', challenge);
    expect(short.status).toBe(400);

    const response = await login('pkce@example.com', 'correct horse battery', 'signup', challenge);
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(`${location.origin}/`).toBe(REDIRECT);
    expect(location.searchParams.get('state')).toBe('state-123');
    const code = location.searchParams.get('code') ?? '';

    const wrong = await token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      code_verifier: pkce().verifier,
    });
    expect(wrong).toMatchObject({ status: 400, body: { error: 'invalid_grant' } });
    // A failed attempt burns the code, as Cognito does.
    const reused = await token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    });
    expect(reused.status).toBe(400);

    const tokens = await signUp('second@example.com');
    expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: 3600 });
    const refreshed = await token({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token!,
    });
    expect(refreshed.body.access_token).toBeTruthy();
    expect(refreshed.body.refresh_token).toBeUndefined();

    await fetch(`${cloud.url}/oauth2/revoke`, {
      method: 'POST',
      body: new URLSearchParams({ token: tokens.refresh_token!, client_id: cloud.auth.clientId }),
    });
    const afterRevoke = await token({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token!,
    });
    expect(afterRevoke.status).toBe(400);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    await signUp('known@example.com');
    const { challenge } = pkce();
    const wrongPassword = await login(
      'known@example.com',
      'not the password!',
      'signin',
      challenge,
    );
    const unknown = await login('nobody@example.com', 'not the password!', 'signin', challenge);
    expect(wrongPassword.status).toBe(400);
    expect(unknown.status).toBe(400);
    const a = await wrongPassword.text();
    const b = await unknown.text();
    expect(a).toContain('Wrong email or password.');
    expect(b).toContain('Wrong email or password.');
  });

  it('refuses requests addressed to another host or from web pages', async () => {
    const page = await fetch(`${cloud.url}/v1/health`, {
      headers: { origin: 'https://evil.example' },
    });
    expect(page.status).toBe(403);
  });
});

describe('two devices syncing through the local cloud', () => {
  it('syncs, merges and resolves conflicts end to end', async () => {
    const tokens = await signUp('sync@example.com');
    const client = new CloudClient({
      apiUrl: cloud.url,
      accessToken: () => Promise.resolve(tokens.access_token!),
    });
    const clock = testClock();
    const laptop = { local: new MemoryLocal(), state: memoryState() };
    const desktop = { local: new MemoryLocal(), state: memoryState() };
    const engines = [laptop, desktop].map((d) => new SyncEngine(d.local, client, d.state));
    const [syncLaptop, syncDesktop] = [() => engines[0]!.run(), () => engines[1]!.run()];

    laptop.local.profile = profile('Muhaid');
    laptop.local.applications = [record('Cloud Intern', clock), record('DevOps Intern', clock)];
    expect(await syncLaptop()).toMatchObject({ outcome: 'synced', pushed: 3 });
    expect(await syncDesktop()).toMatchObject({ outcome: 'synced', appliedHere: 3 });
    expect(desktop.local.applications).toHaveLength(2);

    // Non-overlapping edits merge.
    const id = laptop.local.applications[0]!.id;
    clock.tick();
    laptop.local.applications = laptop.local.applications.map((r) =>
      r.id === id ? addNote(r, 'Phone screen booked', clock) : r,
    );
    clock.tick();
    desktop.local.applications = desktop.local.applications.map((r) =>
      r.id === id ? setStatus(r, 'interview', clock.now()) : r,
    );
    await syncLaptop();
    expect(await syncDesktop()).toMatchObject({ merged: 1, conflicts: 0 });
    await syncLaptop();
    for (const d of [laptop, desktop]) {
      expect(d.local.get(id)).toMatchObject({
        status: 'interview',
        notes: [{ text: 'Phone screen booked' }],
      });
    }

    // A real clash waits for the user.
    laptop.local.applications = laptop.local.applications.map((r) =>
      r.id === id ? updateJob(r, { company: 'Acme Cloud' }, clock.now()) : r,
    );
    desktop.local.applications = desktop.local.applications.map((r) =>
      r.id === id ? updateJob(r, { company: 'Acme Corp' }, clock.now()) : r,
    );
    await syncLaptop();
    expect(await syncDesktop()).toMatchObject({ conflicts: 1 });
    await engines[1]!.resolve('application', id, 'cloud');
    expect(desktop.local.get(id)?.job.company).toBe('Acme Cloud');
    expect(await syncDesktop()).toMatchObject({ conflicts: 0, pushed: 0 });

    // Cloud data deleted from one device: the other stops instead of re-uploading.
    await client.deleteData();
    expect((await syncLaptop()).outcome).toBe('cloud-reset');
    expect((await client.account()).applications).toBe(0);
  });

  it('reports structured errors through the client', async () => {
    const client = new CloudClient({
      apiUrl: cloud.url,
      accessToken: () => Promise.resolve('nope'),
    });
    await expect(client.account()).rejects.toMatchObject({
      name: 'CloudClientError',
      code: 'UNAUTHORIZED',
      status: 401,
    });
    const offline = new CloudClient({
      apiUrl: 'http://127.0.0.1:9',
      accessToken: () => Promise.resolve('x'),
    });
    await expect(offline.account()).rejects.toBeInstanceOf(CloudClientError);
  });

  it('deletes the account: data gone and sign-in refused', async () => {
    const tokens = await signUp('leaving@example.com');
    const client = new CloudClient({
      apiUrl: cloud.url,
      accessToken: () => Promise.resolve(tokens.access_token!),
    });
    const local = new MemoryLocal();
    local.applications = [record('To be deleted', testClock())];
    await new SyncEngine(local, client, memoryState()).run();
    const before = cloud.auth.userCount();
    await client.deleteAccount();
    expect(cloud.auth.userCount()).toBe(before - 1);
    const refresh = await token({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token!,
    });
    expect(refresh.status).toBe(400);
    const { challenge } = pkce();
    expect(
      (await login('leaving@example.com', 'correct horse battery', 'signin', challenge)).status,
    ).toBe(400);
  });
});
