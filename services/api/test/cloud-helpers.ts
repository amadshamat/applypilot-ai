import { randomUUID } from 'node:crypto';
import { emptyProfileContent, PROFILE_VERSION, type Profile } from '@applypilot/shared';
import { createApplication } from '@applypilot/tracking';
import type { ApiRequest, ApiResponse } from '../src/app';
import { createCloudApi, type CloudApiOptions, type UserDirectory } from '../src/cloud/api';
import { jwtAuthenticator } from '../src/cloud/auth';
import { CloudStore } from '../src/cloud/store';
import type { LocalDynamo } from '../src/local/dynamo';
import { createTokenSigner } from '../src/local/tokens';

export const ISSUER = 'https://cognito-idp.ca-central-1.amazonaws.com/ca-central-1_TEST';
export const CLIENT_ID = 'test-client';

export class TestClock {
  t = Date.parse('2026-10-22T12:00:00.000Z');
  now = () => new Date(this.t);
  tick(ms = 1000) {
    this.t += ms;
  }
}

export function setupCloud(dynamo: LocalDynamo, overrides: Partial<CloudApiOptions> = {}) {
  const clock = new TestClock();
  const signer = createTokenSigner(ISSUER, CLIENT_ID);
  // Each setup gets its own table prefix of users, so tests never see each other's data.
  const store = new CloudStore({ doc: dynamo.doc, tableName: dynamo.tableName, now: clock.now });
  const deleted: string[] = [];
  const users: UserDirectory = {
    deleteUser: (username) => {
      deleted.push(username);
      return Promise.resolve();
    },
  };
  const api = createCloudApi({
    store,
    authenticate: jwtAuthenticator({ issuer: ISSUER, clientId: CLIENT_ID, jwks: signer.jwks }),
    users,
    version: '0.6.0',
    now: clock.now,
    ...overrides,
  });

  function user() {
    const sub = randomUUID();
    // The verifier checks expiry against the real clock, so tokens are issued now.
    const token = signer.accessToken({ sub });
    const call = (
      method: string,
      path: string,
      body?: unknown,
      query: Record<string, string> = {},
      headers: Record<string, string> = {},
    ): Promise<ApiResponse> => {
      const request: ApiRequest = {
        method,
        path,
        query,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...headers,
        },
        body: body === undefined ? '' : JSON.stringify(body),
      };
      return api(request);
    };
    return { sub, token, call };
  }

  return { api, store, signer, clock, user, deleted };
}

export function testProfile(fullName: string): Profile {
  const content = emptyProfileContent();
  return {
    ...content,
    personal: { ...content.personal, fullName },
    version: PROFILE_VERSION,
    updatedAt: '2026-10-22T12:00:00.000Z',
  };
}

let n = 0;
export function testRecord(title: string) {
  return createApplication(
    {
      job: {
        title,
        company: 'Acme',
        location: 'Toronto, ON',
        url: '',
        jobKey: '',
        platform: 'manual',
        pay: '',
      },
      source: 'manual',
      status: 'saved',
      matchScore: 70,
    },
    {
      now: () => new Date('2026-10-22T12:00:00.000Z'),
      newId: () => `rec-${++n}-${randomUUID().slice(0, 8)}`,
    },
  );
}

export function errorCode(response: ApiResponse): string | undefined {
  return (response.body as { error?: { code?: string } }).error?.code;
}
