import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const FIXTURES = resolve(import.meta.dirname, '../../../tests/fixtures/jobs');

export function loadFixture(name: string, url: string): Document {
  const html = readFileSync(resolve(FIXTURES, name), 'utf8');
  return new JSDOM(html, { url }).window.document;
}

export function htmlDocument(body: string, url = 'https://careers.example.com/jobs/1'): Document {
  return new JSDOM(`<!doctype html><html><head></head><body>${body}</body></html>`, { url }).window
    .document;
}
