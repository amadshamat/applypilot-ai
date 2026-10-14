import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { RESUME_MIME_TYPES, emptyProfileContent, type ResumeVersionMeta } from '@applypilot/shared';
import { indexedDbResumeStore } from './resume-store';

function meta(id: string, uploadedAt: string): ResumeVersionMeta {
  return {
    id,
    fileName: `${id}.pdf`,
    mimeType: RESUME_MIME_TYPES.pdf,
    size: 4,
    uploadedAt,
    text: 'text',
    parsed: { draft: emptyProfileContent(), sections: [], warnings: [] },
    appliedAt: null,
    label: '',
  };
}

describe('indexedDbResumeStore', () => {
  it('stores resumes with their original bytes, newest first', async () => {
    const store = indexedDbResumeStore(new IDBFactory());
    await store.put(
      meta('a', '2026-10-01T00:00:00.000Z'),
      new Blob(['%PDF'], { type: 'application/pdf' }),
    );
    await store.put(meta('b', '2026-10-02T00:00:00.000Z'), new Blob(['%PDF2']));
    expect((await store.list()).map((m) => m.id)).toEqual(['b', 'a']);
    const file = await store.getFile('a');
    expect(file?.size).toBe(4);
  });

  it('updates metadata without touching the file', async () => {
    const store = indexedDbResumeStore(new IDBFactory());
    await store.put(meta('a', '2026-10-01T00:00:00.000Z'), new Blob(['%PDF']));
    await store.update({
      ...meta('a', '2026-10-01T00:00:00.000Z'),
      appliedAt: '2026-10-03T00:00:00.000Z',
    });
    expect((await store.list())[0]?.appliedAt).toBe('2026-10-03T00:00:00.000Z');
    expect((await store.getFile('a'))?.size).toBe(4);
    await expect(store.update(meta('missing', '2026-10-01T00:00:00.000Z'))).rejects.toThrow(
      /no longer exists/,
    );
  });

  it('rejects invalid metadata', async () => {
    const store = indexedDbResumeStore(new IDBFactory());
    await expect(store.put({ ...meta('a', 'yesterday') }, new Blob(['x']))).rejects.toThrow();
  });

  it('deletes one resume or all of them', async () => {
    const store = indexedDbResumeStore(new IDBFactory());
    await store.put(meta('a', '2026-10-01T00:00:00.000Z'), new Blob(['x']));
    await store.put(meta('b', '2026-10-02T00:00:00.000Z'), new Blob(['y']));
    await store.remove('a');
    expect((await store.list()).map((m) => m.id)).toEqual(['b']);
    expect(await store.getFile('a')).toBeNull();
    await store.clear();
    expect(await store.list()).toEqual([]);
  });
});
