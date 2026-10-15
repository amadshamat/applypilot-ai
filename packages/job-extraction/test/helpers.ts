import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { JSDOM, requestInterceptor } from 'jsdom';

const FIXTURES = resolve(import.meta.dirname, '../../../tests/fixtures/jobs');

export function loadFixture(name: string, url: string): Document {
  const html = readFileSync(resolve(FIXTURES, name), 'utf8');
  return new JSDOM(html, { url }).window.document;
}

export function htmlDocument(body: string, url = 'https://careers.example.com/jobs/1'): Document {
  return new JSDOM(`<!doctype html><html><head></head><body>${body}</body></html>`, { url }).window
    .document;
}

/**
 * Loads a fixture whose iframes point at other fixtures, the way Indeed renders
 * the selected job in a frame. Frame addresses are served from the fixture
 * folder by file name, so they stay same-origin with the page.
 */
export async function loadFixtureWithFrames(
  name: string,
  url: string,
): Promise<{ dom: JSDOM; doc: Document }> {
  // Every request is answered locally; nothing reaches the network.
  const fixtures = requestInterceptor((request) => {
    const file = basename(new URL(request.url).pathname);
    try {
      return new Response(readFileSync(resolve(FIXTURES, file), 'utf8'), {
        headers: { 'Content-Type': 'text/html' },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
  const html = readFileSync(resolve(FIXTURES, name), 'utf8');
  const dom = new JSDOM(html, { url, resources: { interceptors: [fixtures] } });
  await waitForFrames(dom.window.document);
  return { dom, doc: dom.window.document };
}

/** Resolves once every iframe in the document has loaded its current address. */
export async function waitForFrames(doc: Document): Promise<void> {
  const frames = [...doc.querySelectorAll('iframe')];
  await Promise.all(
    frames.map((frame) =>
      frame.contentDocument?.readyState === 'complete' &&
      frame.contentDocument.URL !== 'about:blank'
        ? Promise.resolve()
        : new Promise<void>((done) => frame.addEventListener('load', () => done(), { once: true })),
    ),
  );
}
