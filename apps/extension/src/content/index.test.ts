import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { FormScan, Result } from '@applypilot/shared';

/**
 * The content script runs inside untrusted pages. These tests load it into a
 * jsdom page with a stand-in `chrome` API and check that it answers only the
 * extension itself, only with validated requests, and fills only what it is told.
 */

type Listener = (
  message: unknown,
  sender: { id?: string },
  sendResponse: (response: unknown) => void,
) => boolean;

const EXTENSION_ID = 'applypilot-test-id';
let listener: Listener | undefined;

beforeAll(async () => {
  document.body.innerHTML = `
    <form id="f">
      <label for="email">Email</label><input id="email" type="email">
      <label for="pw">Password</label><input id="pw" type="password">
      <button type="submit">Submit application</button>
    </form>`;
  vi.stubGlobal('chrome', {
    runtime: {
      id: EXTENSION_ID,
      onMessage: {
        addListener: (fn: Listener) => {
          listener = fn;
        },
        removeListener: vi.fn(),
      },
    },
  });
  await import('./index');
});

function send(message: unknown, senderId = EXTENSION_ID): Promise<unknown> {
  return new Promise((resolve) => {
    if (!listener) throw new Error('content script did not register');
    const handled = listener(message, { id: senderId }, resolve);
    // A listener that does not answer returns false and never calls back.
    if (!handled) setTimeout(() => resolve('no answer'), 50);
  });
}

describe('content script', () => {
  it('ignores messages from anything but this extension', async () => {
    expect(await send({ type: 'content/scan-form' }, 'some-other-extension')).toBe('no answer');
  });

  it('ignores malformed requests', async () => {
    expect(await send({ type: 'content/fill-form', instructions: [{ ref: 1 }] })).toBe('no answer');
    expect(await send({ type: 'content/submit-form' })).toBe('no answer');
  });

  it('scans without reading passwords, and fills only the approved field without submitting', async () => {
    let submitted = 0;
    document.getElementById('f')?.addEventListener('submit', (e) => {
      submitted += 1;
      e.preventDefault();
    });
    const scan = (await send({ type: 'content/scan-form' })) as Result<FormScan>;
    expect(scan.ok).toBe(true);
    if (!scan.ok) return;
    expect(scan.data.fields.map((f) => f.label)).toEqual(['Email']);
    const email = scan.data.fields[0];
    if (!email) return;

    const report = (await send({
      type: 'content/fill-form',
      instructions: [
        {
          ref: email.ref,
          control: email.control,
          label: email.label,
          action: { type: 'text', value: 'avery@example.com' },
        },
      ],
    })) as Result<{ results: { status: string }[] }>;
    expect(report.ok && report.data.results.map((r) => r.status)).toEqual(['filled']);
    expect((document.getElementById('email') as HTMLInputElement).value).toBe('avery@example.com');
    expect((document.getElementById('pw') as HTMLInputElement).value).toBe('');
    expect(submitted).toBe(0);
  });
});
