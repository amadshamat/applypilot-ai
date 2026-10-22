import { vi } from 'vitest';
import { CloudAuth, type IdentityApi } from '../src/cloud/auth';
import { CloudSettingsRepository } from '../src/cloud/connection';
import type { SyncRequest, SyncResponse } from '../src/cloud/messages';
import { OFF_STATUS, SyncStatusRepository } from '../src/cloud/sync-store';
import type { CloudAccountClient, CloudServices } from '../src/services/app-services';
import { memoryStore, type KeyValueStore } from '../src/storage/storage-area';

export const REDIRECT = 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/';

const b64 = (value: unknown) =>
  btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** An unsigned JWT-shaped token: the extension only reads ID token claims, the API verifies. */
export const fakeJwt = (claims: Record<string, unknown>) =>
  `${b64({ alg: 'none' })}.${b64(claims)}.sig`;

/** A fake hosted sign-in page: it "signs in" and returns to the redirect with a code. */
export function fakeIdentity(outcome: 'success' | 'cancel' = 'success'): IdentityApi {
  return {
    getRedirectURL: () => REDIRECT,
    launchWebAuthFlow: vi.fn(({ url, interactive }: { url: string; interactive: boolean }) => {
      if (!interactive) return Promise.resolve(undefined);
      if (outcome === 'cancel')
        return Promise.reject(new Error('The user did not approve access.'));
      const state = new URL(url).searchParams.get('state') ?? '';
      return Promise.resolve(`${REDIRECT}?code=the-code&state=${encodeURIComponent(state)}`);
    }),
  };
}

/** A fake token endpoint for the given client id and user. */
export function fakeTokenFetch(
  clientId: string,
  user = { sub: 'user-1', email: 'muhaid@example.com' },
) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = input as string;
    if (url.endsWith('/oauth2/revoke')) return Promise.resolve(new Response('{}', { status: 200 }));
    return Promise.resolve(
      Response.json({
        access_token: fakeJwt({ sub: user.sub, token_use: 'access' }),
        id_token: fakeJwt({ ...user, aud: clientId, token_use: 'id', exp: 9_999_999_999 }),
        refresh_token: 'refresh-1',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
    );
  }) as unknown as typeof fetch;
}

export interface FakeCloudOptions {
  identity?: IdentityApi;
  account?: Partial<CloudAccountClient>;
  sync?: (request: SyncRequest) => SyncResponse | Promise<SyncResponse>;
  grantOrigins?: boolean;
}

export function fakeCloudServices(localStore: KeyValueStore, options: FakeCloudOptions = {}) {
  const session = memoryStore();
  const status = new SyncStatusRepository(localStore);
  const account: CloudAccountClient = {
    account: vi.fn(() => Promise.reject(new Error('not faked'))),
    exportAll: vi.fn(() => Promise.reject(new Error('not faked'))),
    deleteData: vi.fn(() => Promise.resolve()),
    deleteAccount: vi.fn(() => Promise.resolve()),
    ...options.account,
  };
  const cloud: CloudServices = {
    settings: new CloudSettingsRepository(localStore),
    auth: new CloudAuth({
      session,
      identity: options.identity ?? fakeIdentity(),
      fetch: fakeTokenFetch('applypilot-local-client'),
    }),
    status,
    backups: vi.fn(() => Promise.resolve([])),
    client: vi.fn(() => account),
    sync: vi.fn(async (request: SyncRequest) => {
      if (options.sync) return options.sync(request);
      return { ok: true as const, status: await status.save({ ...OFF_STATUS, state: 'synced' }) };
    }),
    requestOrigins: vi.fn(() => Promise.resolve(options.grantOrigins ?? true)),
  };
  return { cloud, account, session };
}
