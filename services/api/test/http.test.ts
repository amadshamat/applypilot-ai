import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createApi } from '../src/app';
import type { ApiConfig } from '../src/config';
import { createHttpServer, hostAllowed, originAllowed } from '../src/http';
import { createMockProvider } from '../src/providers/mock';
import { TOKEN, tailorBody, testConfig } from './helpers';

const EXTENSION = `chrome-extension://${'b'.repeat(32)}`;
let server: Server | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

async function start(overrides: Partial<ApiConfig> = {}) {
  const config = testConfig({ port: 0, ...overrides });
  server = createHttpServer(createApi({ config, provider: createMockProvider() }), config);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  config.port = (server.address() as AddressInfo).port;
  return config;
}

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function call(
  config: ApiConfig,
  options: { method?: string; path?: string; headers?: Record<string, string>; body?: string },
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: config.port,
        method: options.method ?? 'GET',
        path: options.path ?? '/v1/health',
        headers: { host: `127.0.0.1:${config.port}`, ...options.headers },
      },
      (res) => {
        let body = '';
        res.on('data', (c: Buffer) => (body += c.toString()));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end(options.body);
  });
}

describe('origin and host rules', () => {
  it('allows Chrome extension origins and non-browser clients only', () => {
    const config = testConfig();
    expect(originAllowed(undefined, config)).toBe(true);
    expect(originAllowed(EXTENSION, config)).toBe(true);
    expect(originAllowed('https://evil.example', config)).toBe(false);
    expect(originAllowed('chrome-extension://short', config)).toBe(false);
    expect(
      originAllowed(
        EXTENSION,
        testConfig({ allowedOrigins: [`chrome-extension://${'c'.repeat(32)}`] }),
      ),
    ).toBe(false);
  });

  it('accepts only localhost host headers', () => {
    const config = testConfig();
    expect(hostAllowed('127.0.0.1:8787', config)).toBe(true);
    expect(hostAllowed('localhost:8787', config)).toBe(true);
    expect(hostAllowed('attacker.example:8787', config)).toBe(false);
    expect(hostAllowed('127.0.0.1:9999', config)).toBe(false);
    expect(hostAllowed(undefined, config)).toBe(false);
  });
});

describe('local HTTP server', () => {
  it('serves an authenticated request from the extension with CORS headers', async () => {
    const config = await start();
    const res = await call(config, {
      headers: { authorization: `Bearer ${TOKEN}`, origin: EXTENSION },
    });
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(EXTENSION);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, provider: 'mock' });
  });

  it('blocks DNS-rebinding hosts and web page origins', async () => {
    const config = await start();
    const rebinding = await call(config, {
      headers: { authorization: `Bearer ${TOKEN}`, host: `attacker.example:${config.port}` },
    });
    expect(rebinding.status).toBe(403);
    const webPage = await call(config, {
      headers: { authorization: `Bearer ${TOKEN}`, origin: 'https://evil.example' },
    });
    expect(webPage.status).toBe(403);
    expect(webPage.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers CORS and private network preflights for the extension', async () => {
    const config = await start();
    const res = await call(config, {
      method: 'OPTIONS',
      path: '/v1/tailor-resume',
      headers: { origin: EXTENSION, 'access-control-request-private-network': 'true' },
    });
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-headers']).toBe('Authorization, Content-Type');
    expect(res.headers['access-control-allow-private-network']).toBe('true');
  });

  it('rejects oversized bodies', async () => {
    const config = await start({ maxBodyBytes: 1000 });
    const res = await call(config, {
      method: 'POST',
      path: '/v1/tailor-resume',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(5000) }),
    });
    expect(res.status).toBe(413);
    expect(JSON.parse(res.body)).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
  });

  it('generates a draft end to end', async () => {
    const config = await start();
    const res = await call(config, {
      method: 'POST',
      path: '/v1/tailor-resume',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
        origin: EXTENSION,
      },
      body: JSON.stringify(tailorBody()),
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ task: 'tailor-resume', provider: 'mock' });
  });
});
