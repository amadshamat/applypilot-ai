import { describe, expect, it } from 'vitest';
import { buildCandidateContext, buildJobContext } from '@applypilot/ai-core';
import { STORAGE_KEYS } from '@applypilot/shared';
import { sampleJob, sampleProfile } from '../../../../packages/ai-core/test/fixtures';
import {
  AiDraftsRepository,
  MAX_SAVED_DRAFTS,
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
});
