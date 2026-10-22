import { describe, expect, it } from 'vitest';
import { addNote, removeNote, setFollowUp, setStatus, updateJob } from '@applypilot/tracking';
import { canonical, mergeApplication, mergeProfile, same } from '../src';
import { profile, record, testClock } from './helpers';

describe('canonical', () => {
  it('ignores key order', () => {
    expect(canonical({ b: 1, a: { d: 2, c: 3 } })).toBe(canonical({ a: { c: 3, d: 2 }, b: 1 }));
    expect(same([1, 2], [2, 1])).toBe(false);
  });
});

describe('mergeApplication', () => {
  it('keeps notes added on both devices and drops notes deleted on either', () => {
    const clock = testClock();
    let base = record('Cloud Intern', clock);
    base = addNote(base, 'Shared note', clock);
    const shared = base.notes[0]!.id;
    clock.tick();
    const local = addNote(base, 'Added on laptop', clock);
    clock.tick();
    const remote = removeNote(addNote(base, 'Added on desktop', clock), shared, clock.now());

    const result = mergeApplication(base, local, remote);
    expect(result.kind).toBe('merged');
    if (result.kind !== 'merged') return;
    expect(result.value.notes.map((n) => n.text)).toEqual(['Added on desktop', 'Added on laptop']);
    expect(result.value.updatedAt).toBe(remote.updatedAt);
  });

  it('combines status changes from both devices in time order', () => {
    const clock = testClock();
    const base = record('Cloud Intern', clock);
    clock.tick();
    const local = setStatus(base, 'applied', clock.now());
    clock.tick();
    const remote = setStatus(base, 'interview', clock.now());
    const result = mergeApplication(base, local, remote);
    expect(result.kind).toBe('merged');
    if (result.kind !== 'merged') return;
    expect(result.value.history.map((h) => h.status)).toEqual(['saved', 'applied', 'interview']);
    expect(result.value.status).toBe('interview');
  });

  it('takes each field from the side that changed it', () => {
    const clock = testClock();
    const base = record('Cloud Intern', clock);
    const local = updateJob(base, { location: 'Remote' }, clock.now());
    const remote = setFollowUp(base, { due: '2026-10-20', note: 'Email Sam' }, clock.now());
    const result = mergeApplication(base, local, remote);
    expect(result.kind).toBe('merged');
    if (result.kind !== 'merged') return;
    expect(result.value.job.location).toBe('Remote');
    expect(result.value.followUp).toEqual({ due: '2026-10-20', note: 'Email Sam' });
  });

  it('reports a conflict when both devices changed the same field differently', () => {
    const clock = testClock();
    const base = record('Cloud Intern', clock);
    const local = updateJob(base, { title: 'Cloud Engineering Intern' }, clock.now());
    const remote = updateJob(
      setFollowUp(base, { due: '2026-10-20', note: 'a' }, clock.now()),
      { title: 'Cloud Ops Intern' },
      clock.now(),
    );
    const other = setFollowUp(local, { due: '2026-10-21', note: 'b' }, clock.now());
    expect(mergeApplication(base, local, remote)).toEqual({
      kind: 'conflict',
      fields: ['job.title'],
    });
    expect(mergeApplication(base, other, remote)).toEqual({
      kind: 'conflict',
      fields: ['job.title', 'followUp'],
    });
  });

  it('without a common base, keeps notes from both and flags differing fields', () => {
    const clock = testClock();
    const a = addNote(record('Cloud Intern', clock), 'From A', clock);
    const b = { ...addNote({ ...a, notes: [] }, 'From B', clock) };
    const merged = mergeApplication(null, a, b);
    expect(merged.kind).toBe('merged');
    if (merged.kind === 'merged') expect(merged.value.notes).toHaveLength(2);
    const clash = updateJob(b, { company: 'Other' }, clock.now());
    expect(mergeApplication(null, a, clash)).toEqual({ kind: 'conflict', fields: ['job.company'] });
  });
});

describe('mergeProfile', () => {
  it('merges different sections and personal fields', () => {
    const base = profile('Muhaid');
    const local = { ...base, summary: 'Cloud student', updatedAt: '2026-10-02T00:00:00.000Z' };
    const remote = {
      ...base,
      personal: { ...base.personal, phone: '555-0100' },
      updatedAt: '2026-10-03T00:00:00.000Z',
    };
    const result = mergeProfile(base, local, remote);
    expect(result.kind).toBe('merged');
    if (result.kind !== 'merged') return;
    expect(result.value.summary).toBe('Cloud student');
    expect(result.value.personal.phone).toBe('555-0100');
    expect(result.value.updatedAt).toBe('2026-10-03T00:00:00.000Z');
  });

  it('reports a conflict for the same section changed on both', () => {
    const base = profile('Muhaid');
    const local = { ...base, summary: 'A' };
    const remote = { ...base, summary: 'B' };
    expect(mergeProfile(base, local, remote)).toEqual({ kind: 'conflict', fields: ['summary'] });
  });
});
