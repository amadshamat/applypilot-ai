import { describe, expect, it } from 'vitest';
import {
  STORAGE_KEYS,
  emptyProfileContent,
  PROFILE_VERSION,
  type Profile,
} from '@applypilot/shared';
import { LocalDataChangedError } from '@applypilot/sync';
import { createApplication } from '@applypilot/tracking';
import { memoryStore } from '../storage/storage-area';
import { ExtensionLocalData, MAX_BACKUPS } from './local-data';

let n = 0;
const clock = { now: () => new Date('2026-10-20T12:00:00.000Z'), newId: () => `rec-${++n}` };
const record = (title: string) =>
  createApplication(
    {
      job: {
        title,
        company: 'Acme',
        location: '',
        url: '',
        jobKey: '',
        platform: 'manual',
        pay: '',
      },
      source: 'manual',
      status: 'saved',
      matchScore: null,
    },
    clock,
  );
const profile = (fullName: string): Profile => {
  const content = emptyProfileContent();
  return {
    ...content,
    personal: { ...content.personal, fullName },
    version: PROFILE_VERSION,
    updatedAt: '2026-10-20T12:00:00.000Z',
  };
};

describe('ExtensionLocalData', () => {
  it('reads the profile and tracker and applies changes', async () => {
    const store = memoryStore();
    const a = record('Cloud Intern');
    const b = record('DevOps Intern');
    await store.set(STORAGE_KEYS.applications, [a, b]);
    const local = new ExtensionLocalData(store);
    const snapshot = await local.read();
    expect(snapshot).toMatchObject({ profile: null, profileReadable: true });
    expect(snapshot.applications).toHaveLength(2);

    const c = record('Support Intern');
    await local.write(
      {
        profile: profile('Muhaid'),
        upserts: [c, { ...a, notes: [], status: 'applied' }],
        deletes: [b.id],
      },
      snapshot,
    );
    const after = await local.read();
    expect(after.profile?.personal.fullName).toBe('Muhaid');
    expect(after.applications.map((r) => r.job.title)).toEqual(['Support Intern', 'Cloud Intern']);
    expect(after.applications[1]?.status).toBe('applied');
  });

  it('refuses to write when the user changed data since the read', async () => {
    const store = memoryStore();
    const local = new ExtensionLocalData(store);
    const snapshot = await local.read();
    await store.set(STORAGE_KEYS.applications, [record('Typed during sync')]);
    await expect(
      local.write({ upserts: [record('From cloud')], deletes: [] }, snapshot),
    ).rejects.toBeInstanceOf(LocalDataChangedError);
    expect((await local.read()).applications.map((r) => r.job.title)).toEqual([
      'Typed during sync',
    ]);
  });

  it('never syncs, changes or drops entries it cannot read', async () => {
    const store = memoryStore();
    const future = { id: 'future', schemaVersion: 99 };
    await store.set(STORAGE_KEYS.applications, [record('Readable'), future]);
    await store.set(STORAGE_KEYS.profile, { broken: true });
    const local = new ExtensionLocalData(store);
    const snapshot = await local.read();
    expect(snapshot).toMatchObject({ profile: null, profileReadable: false });
    expect(snapshot.applications).toHaveLength(1);
    await local.write(
      { profile: profile('From cloud'), upserts: [], deletes: [snapshot.applications[0]!.id] },
      snapshot,
    );
    expect(await store.get(STORAGE_KEYS.profile)).toEqual({ broken: true });
    expect(await store.get(STORAGE_KEYS.applications)).toEqual([future]);
  });

  it(`keeps the last ${MAX_BACKUPS} backups and restores one, backing up the current data first`, async () => {
    const store = memoryStore();
    const local = new ExtensionLocalData(store);
    const original = record('Original');
    for (const title of ['One', 'Two', 'Three']) {
      await local.backup(
        { profile: profile(title), profileReadable: true, applications: [original] },
        `Backup ${title}`,
      );
    }
    const summaries = await local.backupSummaries();
    expect(summaries.map((s) => s.reason)).toEqual(['Backup Three', 'Backup Two']);
    expect(summaries[0]).toMatchObject({ hasProfile: true, applications: 1 });

    await store.set(STORAGE_KEYS.applications, [record('Current')]);
    expect(await local.restore(summaries[1]!.id)).toBe(true);
    const restored = await local.read();
    expect(restored.profile?.personal.fullName).toBe('Two');
    expect(restored.applications.map((r) => r.job.title)).toEqual(['Original']);
    const after = await local.backupSummaries();
    expect(after[0]?.reason).toBe('Before restoring a backup');
    expect(await local.restore('missing')).toBe(false);
  });
});
