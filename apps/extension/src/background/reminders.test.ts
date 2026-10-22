import { describe, expect, it, vi } from 'vitest';
import { createApplication, setFollowUp, setStatus } from '@applypilot/tracking';
import { ApplicationsRepository } from '../storage/applications-repository';
import { memoryStore } from '../storage/storage-area';
import { refreshFollowUpBadge, type BadgeApi } from './reminders';

function badge() {
  const state = { text: '', title: '' };
  const api: BadgeApi = {
    setText: vi.fn((text: string) => {
      state.text = text;
      return Promise.resolve();
    }),
    setColor: vi.fn(() => Promise.resolve()),
    setTitle: vi.fn((title: string) => {
      state.title = title;
      return Promise.resolve();
    }),
  };
  return { api, state };
}

describe('follow-up badge', () => {
  it('counts follow-ups due on open applications and clears when none are due', async () => {
    const repository = new ApplicationsRepository(memoryStore());
    let n = 0;
    const clock = { now: () => new Date('2026-10-01T12:00:00'), newId: () => `r${++n}` };
    const job = (title: string) => ({
      job: {
        title,
        company: 'Acme',
        location: '',
        url: '',
        jobKey: '',
        platform: 'manual',
        pay: '',
      },
      source: 'manual' as const,
      status: 'applied' as const,
      matchScore: null,
    });
    const due = setFollowUp(
      createApplication(job('A'), clock),
      { due: '2026-10-05', note: '' },
      clock.now(),
    );
    const later = setFollowUp(
      createApplication(job('B'), clock),
      { due: '2026-10-20', note: '' },
      clock.now(),
    );
    const closed = setStatus(
      setFollowUp(createApplication(job('C'), clock), { due: '2026-10-02', note: '' }, clock.now()),
      'rejected',
      clock.now(),
    );
    for (const r of [due, later, closed]) await repository.upsert(r);

    const { api, state } = badge();
    expect(await refreshFollowUpBadge(repository, api, new Date('2026-10-04T09:00:00'))).toBe(0);
    expect(state).toEqual({ text: '', title: 'Open ApplyPilot AI' });
    expect(await refreshFollowUpBadge(repository, api, new Date('2026-10-06T09:00:00'))).toBe(1);
    expect(state).toEqual({ text: '1', title: 'Open ApplyPilot AI: 1 follow-up due' });
    await repository.upsert(setFollowUp(due, null, clock.now()));
    expect(await refreshFollowUpBadge(repository, api, new Date('2026-10-06T09:00:00'))).toBe(0);
    expect(state.text).toBe('');
  });
});
