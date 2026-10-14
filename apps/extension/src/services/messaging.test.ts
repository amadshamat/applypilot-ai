import { describe, expect, it } from 'vitest';
import { sendToBackground } from './messaging';

describe('sendToBackground', () => {
  it('returns validated responses', async () => {
    const response = await sendToBackground(
      { type: 'app/ping' },
      { send: () => Promise.resolve({ ok: true, data: { version: '1.2.3' } }) },
    );
    expect(response).toEqual({ ok: true, data: { version: '1.2.3' } });
  });

  it('turns malformed responses into typed errors', async () => {
    const response = await sendToBackground(
      { type: 'app/ping' },
      { send: () => Promise.resolve({ version: 1 }) },
    );
    expect(response).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
  });

  it('turns transport failures into typed errors', async () => {
    const response = await sendToBackground(
      { type: 'app/ping' },
      { send: () => Promise.reject(new Error('Receiving end does not exist.')) },
    );
    expect(response).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    expect(response.ok ? '' : response.error.message).toContain('Receiving end');
  });

  it('times out instead of hanging when the worker never answers', async () => {
    const response = await sendToBackground(
      { type: 'app/ping' },
      { send: () => new Promise(() => undefined), timeoutMs: 20 },
    );
    expect(response).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } });
  });
});
