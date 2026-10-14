import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FIXTURES = resolve(import.meta.dirname, '../../../tests/fixtures/resumes');

export function fixtureText(name: string): string {
  return readFileSync(resolve(FIXTURES, name), 'utf8');
}

export function fixtureBytes(name: string): ArrayBuffer {
  const buffer = readFileSync(resolve(FIXTURES, name));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

/** Deterministic ids: id-1, id-2, ... */
export function sequentialIds(): () => string {
  let next = 0;
  return () => `id-${String(++next)}`;
}
