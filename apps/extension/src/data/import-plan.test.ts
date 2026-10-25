import { describe, expect, it } from 'vitest';
import { RESUME_MIME_TYPES, STORAGE_KEYS } from '@applypilot/shared';
import { sampleProfile } from '../../../../packages/ai-core/test/fixtures';
import { application, draft, pdfBytes, populated, resumeMeta } from '../../test/data-fixtures';
import { ProfileRepository } from '../storage/profile-repository';
import { memoryResumeStore } from '../storage/resume-store';
import { memoryStore, type KeyValueStore } from '../storage/storage-area';
import { buildBackup, parseBackup, type ParsedBackup } from './backup-format';
import {
  ImportFailedError,
  applyImport,
  loadUndo,
  planImport,
  planIsEmpty,
  readCurrent,
  undoLastImport,
} from './import-plan';
import { describePlan, reportImport } from './import-summary';

async function exported(): Promise<ParsedBackup> {
  const { store, resumes } = await populated();
  const parsed = parseBackup(await buildBackup(store, resumes, { appVersion: '0.7.0' }));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.backup;
}

const titles = async (store: KeyValueStore) =>
  ((await store.get(STORAGE_KEYS.applications)) as { job: { title: string } }[]).map(
    (r) => r.job.title,
  );

describe('import into an empty browser', () => {
  it('restores everything with either mode', async () => {
    for (const mode of ['merge', 'replace'] as const) {
      const backup = await exported();
      const store = memoryStore();
      const resumes = memoryResumeStore();
      const plan = planImport(backup, await readCurrent(store, resumes), mode);
      expect(plan.profile.action).toBe('add');
      await applyImport(plan, { store, resumes, origin: 'test' });
      expect((await new ProfileRepository(store).load()).status).toBe('ok');
      expect(await titles(store)).toEqual(['Cloud intern', 'IT support']);
      expect(await store.get(STORAGE_KEYS.aiDrafts)).toHaveLength(1);
      const [meta] = await resumes.list();
      expect(meta?.id).toBe('resume-1');
      expect(
        new TextDecoder().decode(await (await resumes.getFile('resume-1'))!.arrayBuffer()),
      ).toContain('%PDF-');
      expect(await store.get(STORAGE_KEYS.aiConnection)).toBeUndefined();
      expect(await store.get(STORAGE_KEYS.dataReset)).toMatchObject({
        reason: 'imported',
        origin: 'test',
      });
    }
  });
});

describe('merge', () => {
  it('changes nothing when the same backup is imported again', async () => {
    const { store, resumes } = await populated();
    const backup = parseBackup(await buildBackup(store, resumes, { appVersion: '0.7.0' }));
    if (!backup.ok) throw new Error(backup.error);
    const plan = planImport(backup.backup, await readCurrent(store, resumes), 'merge');
    expect(planIsEmpty(plan)).toBe(true);
    expect(plan.applications.already).toBe(2);
    expect(plan.resumes.already).toBe(1);
    expect(plan.aiDrafts.already).toBe(1);
    expect(plan.profile.action).toBe('same');
  });

  it('adds only what is missing and never overwrites', async () => {
    const backup = await exported();
    const store = memoryStore();
    const resumes = memoryResumeStore();
    const mine = { ...sampleProfile(), summary: 'My newer summary' };
    await new ProfileRepository(store).save(mine);
    const [cloud, support] = backup.applications!.records;
    const edited = { ...cloud!, job: { ...cloud!.job, location: 'Toronto' } };
    // Same job as "IT support" at Globex, tracked here under another id.
    const sameJob = application('IT support', 'Globex');
    await store.set(STORAGE_KEYS.applications, [edited, sameJob]);

    const plan = planImport(backup, await readCurrent(store, resumes), 'merge');
    expect(plan.profile.action).toBe('keep');
    expect(plan.applications).toMatchObject({ added: 0, differing: 1, sameJob: 1 });
    expect(support).toBeDefined();
    expect(describePlan(plan).map((e) => e.tone)).not.toContain('remove');
    await applyImport(plan, { store, resumes, origin: 'test' });
    expect(await new ProfileRepository(store).load()).toMatchObject({
      profile: { summary: 'My newer summary' },
    });
    expect(await store.get(STORAGE_KEYS.applications)).toEqual([edited, sameJob]);
    expect(await resumes.list()).toHaveLength(1);
    const report = reportImport(plan, backup);
    expect(report.removed).toEqual([]);
    expect(report.skipped.join(' ')).toMatch(/changed here \(kept yours\)/);
  });

  it('treats a resume uploaded in both browsers as the same file', async () => {
    const backup = await exported();
    const resumes = memoryResumeStore();
    const bytes = pdfBytes();
    await resumes.put(
      resumeMeta('other-id', bytes),
      new Blob([bytes], { type: RESUME_MIME_TYPES.pdf }),
    );
    await resumes.update({ ...resumeMeta('other-id', bytes), fileName: 'resume-1.pdf' });
    const plan = planImport(backup, await readCurrent(memoryStore(), resumes), 'merge');
    expect(plan.resumes).toMatchObject({ add: [], already: 1 });
  });
});

describe('replace', () => {
  it('makes each part in the file match it and keeps parts the file lacks', async () => {
    const backup = { ...(await exported()), aiDrafts: null };
    const store = memoryStore();
    const resumes = memoryResumeStore();
    await store.set(STORAGE_KEYS.applications, [application('Only here')]);
    await store.set(STORAGE_KEYS.aiDrafts, [draft('https://jobs.example/mine')]);
    const bytes = pdfBytes('mine');
    await resumes.put(
      resumeMeta('mine', bytes),
      new Blob([bytes], { type: RESUME_MIME_TYPES.pdf }),
    );

    const plan = planImport(backup, await readCurrent(store, resumes), 'replace');
    expect(plan.applications).toMatchObject({ added: 2, removed: 1 });
    expect(plan.resumes.remove).toEqual(['mine']);
    // Tracker entry, resume and settings here are replaced or removed.
    expect(describePlan(plan).filter((e) => e.tone === 'remove')).toHaveLength(3);
    await applyImport(plan, { store, resumes, origin: 'test' });
    expect(await titles(store)).toEqual(['Cloud intern', 'IT support']);
    // The file had no AI drafts, so the draft here stays.
    expect(await store.get(STORAGE_KEYS.aiDrafts)).toHaveLength(1);
    expect((await resumes.list()).map((m) => m.id)).toEqual(['resume-1']);
  });

  it('leaves resumes alone when the file has none (old exports)', async () => {
    const backup = { ...(await exported()), resumes: { files: [], withoutFile: 1, invalid: 0 } };
    const resumes = memoryResumeStore();
    const bytes = pdfBytes();
    await resumes.put(
      resumeMeta('mine', bytes),
      new Blob([bytes], { type: RESUME_MIME_TYPES.pdf }),
    );
    const plan = planImport(backup, await readCurrent(memoryStore(), resumes), 'replace');
    expect(plan.resumes.remove).toEqual([]);
  });

  it('keeps tracker entries this version cannot read', async () => {
    const backup = await exported();
    const store = memoryStore();
    const resumes = memoryResumeStore();
    const future = { id: 'future', schema: 99 };
    await store.set(STORAGE_KEYS.applications, [future]);
    await applyImport(planImport(backup, await readCurrent(store, resumes), 'replace'), {
      store,
      resumes,
      origin: 'test',
    });
    expect(await store.get(STORAGE_KEYS.applications)).toContainEqual(future);
  });
});

describe('undo and failures', () => {
  it('undoes the last import exactly', async () => {
    const backup = await exported();
    const store = memoryStore();
    const resumes = memoryResumeStore();
    await store.set(STORAGE_KEYS.applications, [application('Only here')]);
    const before = await store.get(STORAGE_KEYS.applications);
    const bytes = pdfBytes('mine');
    await resumes.put(
      resumeMeta('mine', bytes),
      new Blob([bytes], { type: RESUME_MIME_TYPES.pdf }),
    );

    await applyImport(planImport(backup, await readCurrent(store, resumes), 'replace'), {
      store,
      resumes,
      origin: 'test',
    });
    expect((await loadUndo(store))?.mode).toBe('replace');
    expect(await undoLastImport({ store, resumes, origin: 'test' })).toBe(true);
    expect(await store.get(STORAGE_KEYS.applications)).toEqual(before);
    expect(await store.get(STORAGE_KEYS.profile)).toBeUndefined();
    expect((await resumes.list()).map((m) => m.id)).toEqual(['mine']);
    expect(await (await resumes.getFile('mine'))!.text()).toContain('mine');
    expect(await loadUndo(store)).toBeNull();
    expect(await undoLastImport({ store, resumes, origin: 'test' })).toBe(false);
    expect(await store.get(STORAGE_KEYS.dataReset)).toMatchObject({ reason: 'undone' });
  });

  it('puts everything back when a write fails part-way', async () => {
    const backup = await exported();
    const store = memoryStore();
    const inner = memoryResumeStore();
    await store.set(STORAGE_KEYS.applications, [application('Only here')]);
    const before = await store.get(STORAGE_KEYS.applications);
    const resumes = { ...inner, put: () => Promise.reject(new Error('disk full')) };
    const plan = planImport(backup, await readCurrent(store, resumes), 'replace');
    await expect(applyImport(plan, { store, resumes, origin: 'test' })).rejects.toThrow(
      ImportFailedError,
    );
    expect(await store.get(STORAGE_KEYS.applications)).toEqual(before);
    expect(await store.get(STORAGE_KEYS.profile)).toBeUndefined();
    expect(await store.get(STORAGE_KEYS.dataReset)).toBeUndefined();
  });
});
