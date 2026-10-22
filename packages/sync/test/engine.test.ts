import { describe, expect, it } from 'vitest';
import { addNote, setStatus, updateJob } from '@applypilot/tracking';
import { DELETION_CONFIRM_THRESHOLD, SyncEngine } from '../src';
import { FakeCloud, MemoryLocal, memoryState, profile, record, testClock } from './helpers';

function device(cloud: FakeCloud) {
  const local = new MemoryLocal();
  const state = memoryState();
  const engine = new SyncEngine(local, cloud.transport(), state);
  return { local, state, engine };
}

describe('SyncEngine', () => {
  it('uploads local data on the first run and downloads it on a second device', async () => {
    const cloud = new FakeCloud();
    const clock = testClock();
    const a = device(cloud);
    a.local.profile = profile('Muhaid');
    a.local.applications = [record('Cloud Intern', clock), record('DevOps Intern', clock)];

    const first = await a.engine.run();
    expect(first).toMatchObject({ outcome: 'synced', pushed: 3, appliedHere: 0 });
    expect(cloud.items.size).toBe(3);
    expect(a.state.state.epoch).toBe('epoch-1');

    const b = device(cloud);
    const second = await b.engine.run();
    expect(second).toMatchObject({ outcome: 'synced', pushed: 0, appliedHere: 3 });
    expect(b.local.profile?.personal.fullName).toBe('Muhaid');
    expect(b.local.applications.map((r) => r.job.title).sort()).toEqual([
      'Cloud Intern',
      'DevOps Intern',
    ]);
    // Adding data on an empty device changes nothing that existed, so no backup is needed.
    expect(b.local.backups).toHaveLength(0);

    // Nothing changed: nothing moves.
    expect(await a.engine.run()).toMatchObject({ pushed: 0, appliedHere: 0, pulled: 0 });
  });

  it('merges a device that already has its own data with the cloud', async () => {
    const cloud = new FakeCloud();
    const clock = testClock();
    const a = device(cloud);
    a.local.applications = [record('Cloud Intern', clock)];
    await a.engine.run();

    const b = device(cloud);
    b.local.applications = [record('Support Intern', clock)];
    await b.engine.run();
    expect(b.local.applications).toHaveLength(2);
    await a.engine.run();
    expect(a.local.applications).toHaveLength(2);
  });

  it('merges edits made on two devices to the same record', async () => {
    const cloud = new FakeCloud();
    const clock = testClock();
    const a = device(cloud);
    const b = device(cloud);
    a.local.applications = [record('Cloud Intern', clock)];
    await a.engine.run();
    await b.engine.run();
    const id = a.local.applications[0]!.id;

    clock.tick();
    a.local.applications = [addNote(a.local.get(id)!, 'Called recruiter', clock)];
    clock.tick();
    b.local.applications = [setStatus(b.local.get(id)!, 'applied', clock.now())];
    await a.engine.run();
    const report = await b.engine.run();
    expect(report).toMatchObject({ merged: 1, conflicts: 0 });
    // The backup is taken because the cloud changed a record that was already here.
    expect(b.local.backups).toHaveLength(1);
    await a.engine.run();
    for (const d of [a, b]) {
      const r = d.local.get(id)!;
      expect(r.status).toBe('applied');
      expect(r.notes.map((n) => n.text)).toEqual(['Called recruiter']);
    }
    expect(cloud.items.get(`application:${id}`)?.data).toEqual(a.local.get(id));
  });

  it('parks a real clash as a conflict and lets the user pick a side', async () => {
    const cloud = new FakeCloud();
    const clock = testClock();
    const a = device(cloud);
    const b = device(cloud);
    a.local.applications = [record('Cloud Intern', clock)];
    await a.engine.run();
    await b.engine.run();
    const id = a.local.applications[0]!.id;

    a.local.applications = [updateJob(a.local.get(id)!, { title: 'Title from A' }, clock.now())];
    b.local.applications = [updateJob(b.local.get(id)!, { title: 'Title from B' }, clock.now())];
    await a.engine.run();
    const report = await b.engine.run();
    expect(report.conflicts).toBe(1);
    expect(b.state.state.conflicts[0]).toMatchObject({
      kind: 'application',
      id,
      fields: ['job.title'],
    });
    // B's copy is untouched and not uploaded while the conflict is open.
    expect(b.local.get(id)?.job.title).toBe('Title from B');
    expect(cloud.items.get(`application:${id}`)?.data).toMatchObject({
      job: { title: 'Title from A' },
    });
    await b.engine.run();
    expect(b.local.get(id)?.job.title).toBe('Title from B');

    await b.engine.resolve('application', id, 'local');
    await b.engine.run();
    expect(cloud.items.get(`application:${id}`)?.data).toMatchObject({
      job: { title: 'Title from B' },
    });
    await a.engine.run();
    expect(a.local.get(id)?.job.title).toBe('Title from B');
    expect(b.state.state.conflicts).toEqual([]);
  });

  it('resolving with the cloud copy backs up and replaces the local copy', async () => {
    const cloud = new FakeCloud();
    const a = device(cloud);
    const b = device(cloud);
    a.local.profile = profile('Muhaid');
    await a.engine.run();
    await b.engine.run();
    a.local.profile = { ...a.local.profile, summary: 'From A' };
    b.local.profile = { ...b.local.profile!, summary: 'From B' };
    await a.engine.run();
    await b.engine.run();
    expect(b.state.state.conflicts).toHaveLength(1);
    await b.engine.resolve('profile', 'profile', 'cloud');
    expect(b.local.profile.summary).toBe('From A');
    expect(b.local.backups.at(-1)?.snapshot.profile?.summary).toBe('From B');
    expect(await b.engine.run()).toMatchObject({ pushed: 0, conflicts: 0 });
  });

  it('treats an edit against a deletion as a conflict instead of losing either', async () => {
    const cloud = new FakeCloud();
    const clock = testClock();
    const a = device(cloud);
    const b = device(cloud);
    a.local.applications = [record('Cloud Intern', clock)];
    await a.engine.run();
    await b.engine.run();
    const id = a.local.applications[0]!.id;
    a.local.applications = [];
    b.local.applications = [addNote(b.local.get(id)!, 'Still interested', clock)];
    await a.engine.run();
    expect(cloud.items.get(`application:${id}`)?.data).toBeNull();
    await b.engine.run();
    expect(b.state.state.conflicts[0]?.fields).toEqual(['deleted']);
    expect(b.local.get(id)?.notes).toHaveLength(1);
  });

  it('asks before the cloud deletes many local records, and backs up first', async () => {
    const cloud = new FakeCloud();
    const clock = testClock();
    const a = device(cloud);
    const b = device(cloud);
    const count = DELETION_CONFIRM_THRESHOLD + 1;
    a.local.applications = Array.from({ length: count }, (_, i) => record(`Job ${i}`, clock));
    await a.engine.run();
    await b.engine.run();
    a.local.applications = [];
    await a.engine.run({ allowDeletions: true });

    const report = await b.engine.run();
    expect(report).toMatchObject({ outcome: 'needs-confirmation', pendingDeletions: count });
    expect(b.local.applications).toHaveLength(count);

    const confirmed = await b.engine.run({ allowDeletions: true });
    expect(confirmed.outcome).toBe('synced');
    expect(b.local.applications).toHaveLength(0);
    expect(b.local.backups.at(-1)?.snapshot.applications).toHaveLength(count);
  });

  it('asks before this device deletes many records in the cloud', async () => {
    const cloud = new FakeCloud();
    const clock = testClock();
    const a = device(cloud);
    const count = DELETION_CONFIRM_THRESHOLD + 1;
    a.local.applications = Array.from({ length: count }, (_, i) => record(`Job ${i}`, clock));
    await a.engine.run();
    a.local.applications = [];
    const report = await a.engine.run();
    expect(report).toMatchObject({ outcome: 'needs-confirmation', pendingCloudDeletions: count });
    expect([...cloud.items.values()].every((i) => i.data !== null)).toBe(true);
    await a.engine.run({ allowDeletions: true });
    expect([...cloud.items.values()].every((i) => i.data === null)).toBe(true);
  });

  it('stops without uploading when the cloud data was deleted elsewhere', async () => {
    const cloud = new FakeCloud();
    const clock = testClock();
    const a = device(cloud);
    a.local.applications = [record('Cloud Intern', clock)];
    await a.engine.run();
    cloud.reset();
    a.local.applications = [...a.local.applications, record('New one', clock)];
    const report = await a.engine.run();
    expect(report.outcome).toBe('cloud-reset');
    expect(cloud.items.size).toBe(0);
    expect(a.local.applications).toHaveLength(2);
  });

  it('gives up the round, losing nothing, when local data changes mid-run', async () => {
    const cloud = new FakeCloud();
    const clock = testClock();
    const a = device(cloud);
    const b = device(cloud);
    a.local.applications = [record('Cloud Intern', clock)];
    await a.engine.run();
    b.local.onWrite = () => {
      b.local.applications = [record('Typed during sync', clock)];
    };
    expect((await b.engine.run()).outcome).toBe('retry');
    expect(b.local.applications.map((r) => r.job.title)).toEqual(['Typed during sync']);
    b.local.onWrite = null;
    await b.engine.run();
    expect(b.local.applications).toHaveLength(2);
  });

  it('re-reads and merges when another device wrote between pull and push', async () => {
    const cloud = new FakeCloud();
    const clock = testClock();
    const a = device(cloud);
    a.local.applications = [record('Cloud Intern', clock)];
    await a.engine.run();
    const id = a.local.applications[0]!.id;
    a.local.applications = [addNote(a.local.get(id)!, 'From A', clock)];
    // Another device writes right after A pulls.
    const transport = cloud.transport();
    const racing = new SyncEngine(
      a.local,
      {
        changes: async (since, page) => {
          const response = await transport.changes(since, page);
          const current = cloud.items.get(`application:${id}`)!;
          if (current.version === 1) {
            cloud.write({
              kind: 'application',
              id,
              data: addNote(current.data as never, 'From B', clock),
            });
          }
          return response;
        },
        push: transport.push,
      },
      a.state,
    );
    const report = await racing.run();
    expect(report.conflicts).toBe(0);
    expect(
      a.local
        .get(id)
        ?.notes.map((n) => n.text)
        .sort(),
    ).toEqual(['From A', 'From B']);
    expect(cloud.items.get(`application:${id}`)?.version).toBe(3);
  });

  it('leaves an unreadable local profile alone', async () => {
    const cloud = new FakeCloud();
    cloud.write({ kind: 'profile', id: 'profile', data: profile('Cloud copy') });
    const a = device(cloud);
    a.local.profileReadable = false;
    const report = await a.engine.run();
    expect(report.appliedHere).toBe(0);
    expect(a.local.profile).toBeNull();
  });
});
