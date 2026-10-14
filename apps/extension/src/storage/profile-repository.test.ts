import { describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS, emptyProfileContent } from '@applypilot/shared';
import { ProfileRepository } from './profile-repository';
import { memoryStore } from './storage-area';

const NOW = new Date('2026-10-14T12:00:00Z');

describe('ProfileRepository', () => {
  it('reports an empty profile when nothing is stored', async () => {
    await expect(new ProfileRepository(memoryStore()).load()).resolves.toEqual({ status: 'empty' });
  });

  it('saves a validated profile with version and timestamp, trimming text', async () => {
    const store = memoryStore();
    const repository = new ProfileRepository(store, () => NOW);
    const content = emptyProfileContent();
    content.personal.fullName = '  Jordan Rivera ';
    const saved = await repository.save(content);
    expect(saved).toMatchObject({
      version: 1,
      updatedAt: NOW.toISOString(),
      personal: { fullName: 'Jordan Rivera' },
    });
    await expect(repository.load()).resolves.toEqual({ status: 'ok', profile: saved });
  });

  it('refuses to save invalid data and leaves storage untouched', async () => {
    const store = memoryStore();
    const repository = new ProfileRepository(store, () => NOW);
    const content = emptyProfileContent();
    content.personal.email = 'not-an-email';
    await expect(repository.save(content)).rejects.toThrow();
    expect(await store.get(STORAGE_KEYS.profile)).toBeUndefined();
  });

  it('reports corrupt data without overwriting it', async () => {
    const raw = { version: 99, personal: 'nope' };
    const store = memoryStore({ [STORAGE_KEYS.profile]: raw });
    await expect(new ProfileRepository(store).load()).resolves.toEqual({ status: 'corrupt', raw });
    expect(await store.get(STORAGE_KEYS.profile)).toEqual(raw);
  });

  it('notifies subscribers and clears', async () => {
    const store = memoryStore();
    const repository = new ProfileRepository(store, () => NOW);
    const listener = vi.fn();
    repository.subscribe(listener);
    await repository.save(emptyProfileContent());
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ok' }));
    await repository.clear();
    expect(listener).toHaveBeenLastCalledWith({ status: 'empty' });
  });
});
