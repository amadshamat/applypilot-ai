import { describe, expect, it } from 'vitest';
import { buildCandidateContext, buildJobContext } from '@applypilot/ai-core';
import { STORAGE_KEYS } from '@applypilot/shared';
import { sampleJob, sampleProfile } from '../../../../packages/ai-core/test/fixtures';
import {
  AiDraftsRepository,
  MAX_EDIT_LENGTH,
  MAX_SAVED_DRAFTS,
  hasEdits,
  jobKeyFor,
  type SavedDraft,
} from './ai-drafts-repository';
import { memoryStore } from './storage-area';

function draft(
  jobKey: string,
  generatedAt = '2026-10-14T12:00:00.000Z',
): SavedDraft<'cover-letter'> {
  return {
    task: 'cover-letter',
    jobKey,
    savedAt: generatedAt,
    request: {
      job: buildJobContext(sampleJob()),
      candidate: buildCandidateContext(sampleProfile(), { includeName: true }).context,
      options: { tone: 'warm', length: 'short', notes: '' },
    },
    response: {
      task: 'cover-letter',
      promptVersion: 'cover-letter@2026-10-14.1',
      provider: 'mock',
      model: 'mock-drafter',
      output: {
        greeting: 'Dear Hiring Manager,',
        paragraphs: ['Hello.'],
        closing: 'Sincerely,',
        sources: [],
      },
      usage: null,
      skipped: [],
      generatedAt,
    },
  };
}

describe('AiDraftsRepository', () => {
  it('keeps the latest draft per task and job', async () => {
    const repo = new AiDraftsRepository(memoryStore());
    await repo.save(draft('https://jobs.example/1'));
    await repo.save(draft('https://jobs.example/1', '2026-10-14T13:00:00.000Z'));
    await repo.save(draft('https://jobs.example/2'));
    expect(await repo.list()).toHaveLength(2);
    expect((await repo.find('cover-letter', 'https://jobs.example/1'))?.savedAt).toBe(
      '2026-10-14T13:00:00.000Z',
    );
    expect(await repo.find('tailor-resume', 'https://jobs.example/1')).toBeNull();
    await repo.remove('cover-letter', 'https://jobs.example/1');
    expect(await repo.list()).toHaveLength(1);
  });

  it('caps how many drafts are kept', async () => {
    const repo = new AiDraftsRepository(memoryStore());
    for (let i = 0; i < MAX_SAVED_DRAFTS + 5; i++)
      await repo.save(draft(`https://jobs.example/${i}`));
    const drafts = await repo.list();
    expect(drafts).toHaveLength(MAX_SAVED_DRAFTS);
    expect(drafts[0]?.jobKey).toBe(`https://jobs.example/${MAX_SAVED_DRAFTS + 4}`);
  });

  it('ignores stored entries that fail validation', async () => {
    const store = memoryStore();
    const good = draft('https://jobs.example/1');
    await store.set(STORAGE_KEYS.aiDrafts, [
      good,
      { ...good, response: { ...good.response, output: 'tampered' } },
      'junk',
    ]);
    expect(await new AiDraftsRepository(store).list()).toHaveLength(1);
    await store.set(STORAGE_KEYS.aiDrafts, { not: 'a list' });
    expect(await new AiDraftsRepository(store).list()).toEqual([]);
  });

  it('keys jobs by URL without the fragment', () => {
    expect(jobKeyFor('https://jobs.example/1?gh_jid=2#apply')).toBe(
      'https://jobs.example/1?gh_jid=2',
    );
  });

  it('stores edits per part next to the generated text, only on the same draft', async () => {
    const store = memoryStore();
    const repo = new AiDraftsRepository(store);
    const job = 'https://jobs.example/1';
    await repo.save(draft(job));
    const at = '2026-10-14T12:00:00.000Z';
    await repo.saveEdit(
      'cover-letter',
      job,
      at,
      'letter',
      'My letter',
      new Date('2026-10-15T00:00:00Z'),
    );
    const saved = await repo.find('cover-letter', job);
    expect(saved).toMatchObject({
      edits: { letter: 'My letter' },
      editedAt: '2026-10-15T00:00:00.000Z',
    });
    expect(saved?.response.output.paragraphs).toEqual(['Hello.']);
    expect(hasEdits(saved!)).toBe(true);

    // An edit for another generation never lands on this draft.
    expect(
      await repo.saveEdit('cover-letter', job, '2026-10-13T00:00:00.000Z', 'letter', 'x'),
    ).toBeNull();
    expect(
      await repo.saveEdit('cover-letter', 'https://jobs.example/2', at, 'letter', 'x'),
    ).toBeNull();
    expect((await repo.find('cover-letter', job))?.edits).toEqual({ letter: 'My letter' });

    await repo.saveEdit('cover-letter', job, at, 'letter', null);
    expect((await repo.find('cover-letter', job))?.edits).toBeUndefined();
  });

  it('keeps both of two edits saved at the same moment', async () => {
    const repo = new AiDraftsRepository(memoryStore());
    const job = 'https://jobs.example/1';
    await repo.save(draft(job));
    const at = '2026-10-14T12:00:00.000Z';
    await Promise.all([
      repo.saveEdit('cover-letter', job, at, 'Q1', 'one'),
      repo.saveEdit('cover-letter', job, at, 'Q2', 'two'),
    ]);
    expect((await repo.find('cover-letter', job))?.edits).toEqual({ Q1: 'one', Q2: 'two' });
  });

  it('keeps an edited draft when a new one is generated, and can restore it', async () => {
    const repo = new AiDraftsRepository(memoryStore());
    const job = 'https://jobs.example/1';
    await repo.save(draft(job));
    await repo.saveEdit('cover-letter', job, '2026-10-14T12:00:00.000Z', 'letter', 'Edited');
    const fresh = await repo.save(draft(job, '2026-10-14T13:00:00.000Z'));
    expect(fresh.previous?.edits).toEqual({ letter: 'Edited' });
    expect(fresh.edits).toBeUndefined();
    // Generating again without editing keeps the same edited version available.
    const again = await repo.save(draft(job, '2026-10-14T14:00:00.000Z'));
    expect(again.previous?.response.generatedAt).toBe('2026-10-14T12:00:00.000Z');

    const restored = await repo.restorePrevious('cover-letter', job);
    expect(restored).toMatchObject({
      edits: { letter: 'Edited' },
      response: { generatedAt: '2026-10-14T12:00:00.000Z' },
    });
    // The unedited newer draft is not kept.
    expect(restored?.previous).toBeUndefined();
    expect(await repo.restorePrevious('cover-letter', job)).toBeNull();
    expect(await repo.list()).toHaveLength(1);
  });

  it('swaps two edited versions back and forth', async () => {
    const repo = new AiDraftsRepository(memoryStore());
    const job = 'https://jobs.example/1';
    await repo.save(draft(job));
    await repo.saveEdit('cover-letter', job, '2026-10-14T12:00:00.000Z', 'letter', 'First');
    await repo.save(draft(job, '2026-10-14T13:00:00.000Z'));
    await repo.saveEdit('cover-letter', job, '2026-10-14T13:00:00.000Z', 'letter', 'Second');
    const restored = await repo.restorePrevious('cover-letter', job);
    expect(restored?.edits).toEqual({ letter: 'First' });
    expect(restored?.previous?.edits).toEqual({ letter: 'Second' });
  });

  it('drops edits that do not fit but keeps the draft', async () => {
    const store = memoryStore();
    const good = draft('https://jobs.example/1');
    await store.set(STORAGE_KEYS.aiDrafts, [
      { ...good, edits: { letter: 42 }, editedAt: 'yesterday', previous: { junk: true } },
    ]);
    const [loaded] = await new AiDraftsRepository(store).list();
    expect(loaded).toBeDefined();
    expect(loaded?.edits).toBeUndefined();
    expect(loaded?.editedAt).toBeUndefined();
    expect(loaded?.previous).toBeUndefined();
    const tooLong = 'x'.repeat(MAX_EDIT_LENGTH + 1);
    await store.set(STORAGE_KEYS.aiDrafts, [{ ...good, edits: { letter: tooLong } }]);
    expect((await new AiDraftsRepository(store).list())[0]?.edits).toBeUndefined();
  });
});
