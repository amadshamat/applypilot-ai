import { describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@applypilot/shared';
import { REDIRECT, fakeIdentity, fakeTokenFetch } from '../../test/cloud-fakes';
import { memoryStore } from '../storage/storage-area';
import { CloudAuth, CloudAuthError } from './auth';
import { LOCAL_TEST_CONNECTION as connection } from './connection';

const sha256url = async (text: string) => {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
  );
  return btoa(String.fromCharCode(...digest))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

function setup(overrides: Partial<ConstructorParameters<typeof CloudAuth>[0]> = {}) {
  const session = memoryStore();
  const identity = fakeIdentity();
  const fetch = fakeTokenFetch(connection.clientId);
  let now = 1_000_000;
  const auth = new CloudAuth({ session, identity, fetch, now: () => now, ...overrides });
  return { auth, session, identity, fetch, advance: (ms: number) => (now += ms) };
}

describe('CloudAuth', () => {
  it('signs in with the code flow and PKCE, keeping tokens in session storage only', async () => {
    const { auth, session, identity, fetch } = setup();
    const result = await auth.signIn(connection);
    expect(result).toMatchObject({ userId: 'user-1', email: 'muhaid@example.com' });
    expect(await session.get(STORAGE_KEYS.cloudSession)).toMatchObject({ userId: 'user-1' });

    const launched = new URL(vi.mocked(identity.launchWebAuthFlow).mock.calls[0]![0].url);
    expect(launched.pathname).toBe('/oauth2/authorize');
    expect(launched.searchParams.get('response_type')).toBe('code');
    expect(launched.searchParams.get('code_challenge_method')).toBe('S256');
    expect(launched.searchParams.get('redirect_uri')).toBe(REDIRECT);

    // The verifier goes only to the token endpoint, and matches the challenge sent earlier.
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const form = new URLSearchParams(init?.body as string);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(await sha256url(form.get('code_verifier')!)).toBe(
      launched.searchParams.get('code_challenge'),
    );
    expect(launched.toString()).not.toContain(form.get('code_verifier')!);
  });

  it('refuses an answer for a sign-in it did not start', async () => {
    const identity = {
      getRedirectURL: () => REDIRECT,
      launchWebAuthFlow: () => Promise.resolve(`${REDIRECT}?code=stolen&state=someone-elses`),
    };
    const { auth, session } = setup({ identity });
    await expect(auth.signIn(connection)).rejects.toMatchObject({ code: 'FAILED' });
    expect(await session.get(STORAGE_KEYS.cloudSession)).toBeUndefined();
  });

  it('refuses ID tokens issued to another app', async () => {
    const { auth } = setup({ fetch: fakeTokenFetch('another-client') });
    await expect(auth.signIn(connection)).rejects.toBeInstanceOf(CloudAuthError);
  });

  it('reports a closed sign-in window as cancelled', async () => {
    const { auth } = setup({ identity: fakeIdentity('cancel') });
    await expect(auth.signIn(connection)).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('renews the access token shortly before it expires, once for parallel callers', async () => {
    const { auth, fetch, advance } = setup();
    const first = (await auth.signIn(connection)).accessToken;
    expect(await auth.accessToken(connection)).toBe(first);
    advance(3600_000 - 30_000);
    const [a, b] = await Promise.all([auth.accessToken(connection), auth.accessToken(connection)]);
    expect(a).toBe(b);
    const grants = vi
      .mocked(fetch)
      .mock.calls.map(([, init]) => new URLSearchParams(init?.body as string).get('grant_type'));
    expect(grants).toEqual(['authorization_code', 'refresh_token']);
  });

  it('signs out when the refresh token is refused', async () => {
    const { auth, session, advance } = setup();
    await auth.signIn(connection);
    const refused = vi.fn(() =>
      Promise.resolve(Response.json({ error: 'invalid_grant' }, { status: 400 })),
    );
    const expired = new CloudAuth({
      session,
      identity: fakeIdentity(),
      fetch: refused,
      now: () => 1_000_000 + 7200_000,
    });
    advance(0);
    await expect(expired.accessToken(connection)).rejects.toMatchObject({ code: 'SIGNED_OUT' });
    expect(await session.get(STORAGE_KEYS.cloudSession)).toBeUndefined();
  });

  it('ignores a session made for another deployment', async () => {
    const { auth } = setup();
    await auth.signIn(connection);
    const other = { ...connection, clientId: 'other' };
    expect(await auth.sessionFor(other)).toBeNull();
    await expect(auth.accessToken(other)).rejects.toMatchObject({ code: 'SIGNED_OUT' });
  });

  it('signs out by forgetting the tokens and revoking the refresh token', async () => {
    const { auth, session, fetch } = setup();
    await auth.signIn(connection);
    await auth.signOut(connection);
    expect(await session.get(STORAGE_KEYS.cloudSession)).toBeUndefined();
    const last = vi.mocked(fetch).mock.calls.at(-1)!;
    expect(last[0] as string).toBe(`${connection.authUrl}/oauth2/revoke`);
    expect(new URLSearchParams(last[1]?.body as string).get('token')).toBe('refresh-1');
  });
});
