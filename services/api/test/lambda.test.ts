import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { UserNotFoundException } from '@aws-sdk/client-cognito-identity-provider';
import { jwtAuthenticator } from '../src/cloud/auth';
import { startLocalDynamo, type LocalDynamo } from '../src/local/dynamo';
import { createTokenSigner } from '../src/local/tokens';
import { toApiRequest, type ApiGatewayEvent } from '../src/lambda/adapter';
import {
  cognitoUsers,
  createAiHandler,
  createCloudHandler,
  secretReader,
} from '../src/lambda/handlers';
import { createMockProvider } from '../src/providers/mock';
import { CLIENT_ID, ISSUER, testRecord } from './cloud-helpers';
import { tailorBody } from './helpers';

const EXTENSION = `chrome-extension://${'b'.repeat(32)}`;

let dynamo: LocalDynamo;
beforeAll(async () => {
  dynamo = await startLocalDynamo();
});
afterAll(async () => {
  await dynamo.close();
});

const signer = createTokenSigner(ISSUER, CLIENT_ID);
const authenticate = jwtAuthenticator({ issuer: ISSUER, clientId: CLIENT_ID, jwks: signer.jwks });
const env = {
  AWS_REGION: 'ca-central-1',
  TABLE_NAME: 'applypilot-local',
  USER_POOL_ID: 'ca-central-1_TEST',
  USER_POOL_CLIENT_ID: CLIENT_ID,
  ALLOWED_ORIGINS: `${EXTENSION},https://evil.example`,
};

function event(
  method: string,
  path: string,
  token: string | null,
  body: unknown = null,
  extra: Partial<ApiGatewayEvent> = {},
): ApiGatewayEvent {
  return {
    httpMethod: method,
    path,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === null ? {} : { 'Content-Type': 'application/json' }),
      Origin: EXTENSION,
    },
    queryStringParameters: null,
    body: body === null ? null : JSON.stringify(body),
    isBase64Encoded: false,
    requestContext: { requestId: 'req-123' },
    ...extra,
  };
}

describe('API Gateway adapter', () => {
  it('lower-cases headers, decodes base64 bodies and keeps the request id', () => {
    const request = toApiRequest({
      ...event('POST', '/v1/sync/push', 'tok', null),
      body: Buffer.from('{"a":1}').toString('base64'),
      isBase64Encoded: true,
      queryStringParameters: { since: '5' },
    });
    expect(request).toMatchObject({
      method: 'POST',
      path: '/v1/sync/push',
      body: '{"a":1}',
      query: { since: '5' },
      requestId: 'req-123',
      headers: { authorization: 'Bearer tok', origin: EXTENSION },
    });
  });
});

describe('data function', () => {
  it('serves data routes with security headers and CORS for the extension only', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const handler = createCloudHandler('data', env, { doc: dynamo.doc, authenticate });
    const token = signer.accessToken({ sub: 'user-lambda-1' });
    const record = testRecord('Lambda Intern');
    const put = await handler(
      event('PUT', `/v1/applications/${record.id}`, token, { baseVersion: 0, data: record }),
    );
    expect(put.statusCode).toBe(200);
    expect(put.headers).toMatchObject({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Strict-Transport-Security': expect.stringContaining('max-age=') as unknown,
      'Access-Control-Allow-Origin': EXTENSION,
    });
    const foreign = await handler({
      ...event('GET', '/v1/health', null),
      headers: { Origin: 'https://example.com' },
    });
    expect(foreign.headers['Access-Control-Allow-Origin']).toBeUndefined();

    const unauthorized = await handler(event('GET', '/v1/account', null));
    expect(unauthorized.statusCode).toBe(401);
    expect(JSON.parse(unauthorized.body)).toMatchObject({
      error: { code: 'UNAUTHORIZED', requestId: 'req-123' },
    });
    // Account deletion is not served by the data function.
    expect((await handler(event('DELETE', '/v1/account', token))).statusCode).toBe(405);
    // Logs are JSON lines without personal data.
    const lines = vi.mocked(console.log).mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes('"route":"PUT /v1/applications/{id}"'))).toBe(true);
    expect(lines.join('\n')).not.toContain(record.id);
    vi.restoreAllMocks();
  });
});

describe('account function', () => {
  it('deletes data and then the Cognito user', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const deleteUser = vi.fn(() => Promise.resolve());
    const handler = createCloudHandler('account', env, {
      doc: dynamo.doc,
      authenticate,
      users: { deleteUser },
    });
    const token = signer.accessToken({ sub: 'user-lambda-2', username: 'user-lambda-2' });
    const response = await handler(event('DELETE', '/v1/account', token));
    expect(response.statusCode).toBe(200);
    expect(deleteUser).toHaveBeenCalledWith('user-lambda-2');
    vi.restoreAllMocks();
  });

  it('treats an already deleted Cognito user as done', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new UserNotFoundException({ message: 'gone', $metadata: {} }))
      .mockRejectedValueOnce(new Error('throttled'));
    const users = cognitoUsers('pool', { send } as never);
    await expect(users.deleteUser('x')).resolves.toBeUndefined();
    await expect(users.deleteUser('x')).rejects.toThrow('throttled');
  });
});

describe('AI function', () => {
  it('requires a Cognito token and applies a per-user daily limit', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const handler = createAiHandler(
      { ...env, AI_DAILY_LIMIT: '1' },
      { doc: dynamo.doc, authenticate, provider: createMockProvider() },
    );
    const alice = signer.accessToken({ sub: 'ai-user-1' });
    const bob = signer.accessToken({ sub: 'ai-user-2' });
    expect((await handler(event('POST', '/v1/tailor-resume', null, tailorBody()))).statusCode).toBe(
      401,
    );
    expect(
      (await handler(event('POST', '/v1/tailor-resume', alice, tailorBody()))).statusCode,
    ).toBe(200);
    const limited = await handler(event('POST', '/v1/tailor-resume', alice, tailorBody()));
    expect(limited.statusCode).toBe(429);
    expect(JSON.parse(limited.body)).toMatchObject({ error: { code: 'DAILY_LIMIT' } });
    expect((await handler(event('POST', '/v1/tailor-resume', bob, tailorBody()))).statusCode).toBe(
      200,
    );
    const health = await handler(event('GET', '/v1/health', alice));
    expect(JSON.parse(health.body)).toMatchObject({ requestsToday: 1, dailyLimit: 1 });
    vi.restoreAllMocks();
  });

  it('never calls Claude unless the stack turned it on', () => {
    // No secret ARN needed and no secret read in mock mode.
    expect(() => createAiHandler(env, { doc: dynamo.doc, authenticate })).not.toThrow();
    expect(() =>
      createAiHandler({ ...env, AI_PROVIDER: 'anthropic' }, { doc: dynamo.doc }),
    ).toThrow('ANTHROPIC_SECRET_ARN');
  });
});

describe('secretReader', () => {
  it('reads the key once, and retries after a failure', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('denied'))
      .mockResolvedValueOnce({ SecretString: ' sk-ant-test \n' })
      .mockResolvedValueOnce({ SecretString: 'other' });
    const read = secretReader('arn', { send } as never);
    await expect(read()).rejects.toThrow('denied');
    await expect(read()).resolves.toBe('sk-ant-test');
    await expect(read()).resolves.toBe('sk-ant-test');
    expect(send).toHaveBeenCalledTimes(2);
    const empty = secretReader('arn', {
      send: () => Promise.resolve({ SecretString: '' }),
    } as never);
    await expect(empty()).rejects.toThrow('empty');
  });
});
