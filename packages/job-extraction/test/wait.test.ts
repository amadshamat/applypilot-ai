import { afterEach, describe, expect, it, vi } from 'vitest';
import { isJobContentReady, waitForJobContent } from '../src';
import { htmlDocument } from './helpers';

const LONG_TEXT = 'Responsibilities include building and operating services. '.repeat(6);

afterEach(() => {
  vi.useRealTimers();
});

describe('waitForJobContent', () => {
  it('resolves immediately when content is already present', async () => {
    const doc = htmlDocument(`<h1>Role</h1><div class="job-description"><p>${LONG_TEXT}</p></div>`);
    expect(isJobContentReady(doc)).toBe(true);
    await expect(waitForJobContent(doc, { timeoutMs: 1000 })).resolves.toBe(true);
  });

  it('resolves once client-rendered content appears', async () => {
    const doc = htmlDocument('<div id="root"></div>');
    const pending = waitForJobContent(doc, { timeoutMs: 2000, checkIntervalMs: 10 });
    setTimeout(() => {
      doc.getElementById('root')!.innerHTML =
        `<h1>Role</h1><div class="job-description"><p>${LONG_TEXT}</p></div>`;
    }, 20);
    await expect(pending).resolves.toBe(true);
  });

  it('gives up at the timeout without throwing', async () => {
    vi.useFakeTimers();
    const doc = htmlDocument('<div id="root"></div>');
    const pending = waitForJobContent(doc, { timeoutMs: 500 });
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toBe(false);
  });
});
