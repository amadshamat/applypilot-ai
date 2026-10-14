import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '@applypilot/shared';
import { SettingsRepository } from './settings-repository';
import { memoryStore } from './storage-area';

describe('SettingsRepository', () => {
  it('returns defaults when nothing is stored', async () => {
    await expect(new SettingsRepository(memoryStore()).load()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid stored fields and repairs corrupt ones', async () => {
    const store = memoryStore({
      [STORAGE_KEYS.settings]: {
        version: 1,
        theme: 'dark',
        allowAiProcessing: 'yes',
        cacheAnalyses: false,
        matchWeights: { requiredSkills: 99 },
      },
    });
    const settings = await new SettingsRepository(store).load();
    expect(settings).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark', cacheAnalyses: false });
  });

  it('refuses to save invalid settings', async () => {
    const repo = new SettingsRepository(memoryStore());
    const invalid = {
      ...DEFAULT_SETTINGS,
      matchWeights: { ...DEFAULT_SETTINGS.matchWeights, education: 50 },
    };
    await expect(repo.save(invalid)).rejects.toThrow(/add up to 100/);
  });

  it('applies partial updates and notifies subscribers', async () => {
    const repo = new SettingsRepository(memoryStore());
    const listener = vi.fn();
    repo.subscribe(listener);
    await repo.update({ allowAiProcessing: true });
    expect(listener).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, allowAiProcessing: true });
    await expect(repo.load()).resolves.toMatchObject({ allowAiProcessing: true });
  });
});
