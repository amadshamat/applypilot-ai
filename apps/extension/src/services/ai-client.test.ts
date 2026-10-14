import { describe, expect, it, vi } from 'vitest';
import { AiClientError, createAiClient } from './ai-client';

const connection = { apiUrl: 'http://127.0.0.1:8787', token: 'tok' };
const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

async function failure(promise: Promise<unknown>) {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(AiClientError);
  return error as AiClientError;
}

describe('createAiClient', () => {
  it('sends the bearer token and never sends cookies', async () => {
    const fetchImpl = vi.fn(() =>
      json(200, {
        ok: true,
        service: 'applypilot-api',
        version: '0.1.0',
        provider: 'mock',
        model: 'mock-drafter',
        requestsToday: 0,
        dailyLimit: 25,
      }),
    );
    await createAiClient(fetchImpl).health(connection);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8787/v1/health');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer tok');
    expect(init.credentials).toBe('omit');
  });

  it('explains when the API is not running', async () => {
    const error = await failure(
      createAiClient(() => Promise.reject(new TypeError('Failed to fetch'))).health(connection),
    );
    expect(error.code).toBe('NETWORK');
    expect(error.message).toMatch(/pnpm api/);
  });

  it('reports timeouts', async () => {
    const error = await failure(
      createAiClient(() => Promise.reject(new DOMException('slow', 'TimeoutError'))).health(
        connection,
      ),
    );
    expect(error.code).toBe('TIMEOUT');
  });

  it('passes API error codes and messages through', async () => {
    const error = await failure(
      createAiClient(() =>
        json(429, { error: { code: 'DAILY_LIMIT', message: 'Limit reached.' } }),
      ).run(connection, 'cover-letter', {} as never),
    );
    expect(error).toMatchObject({ code: 'DAILY_LIMIT', message: 'Limit reached.' });
  });

  it('rejects responses that break the contract', async () => {
    expect(
      (await failure(createAiClient(() => json(200, { ok: true })).health(connection))).code,
    ).toBe('BAD_RESPONSE');
    expect(
      (
        await failure(
          createAiClient(() => json(200, { task: 'cover-letter', output: 'free text' })).run(
            connection,
            'cover-letter',
            {} as never,
          ),
        )
      ).code,
    ).toBe('BAD_RESPONSE');
    expect(
      (
        await failure(
          createAiClient(() => Promise.resolve(new Response('<html>', { status: 200 }))).health(
            connection,
          ),
        )
      ).code,
    ).toBe('BAD_RESPONSE');
    expect(
      (await failure(createAiClient(() => json(500, { nope: true })).health(connection))).message,
    ).toMatch(/status 500/);
  });
});
