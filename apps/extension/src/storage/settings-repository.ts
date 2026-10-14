import { DEFAULT_SETTINGS, STORAGE_KEYS, settingsSchema, type Settings } from '@applypilot/shared';
import type { KeyValueStore } from './storage-area';

/**
 * Reads and writes user settings. Stored data is validated on every read:
 * missing, corrupt or outdated values fall back to defaults field by field,
 * so a bad write can never brick the extension.
 */
export class SettingsRepository {
  constructor(private readonly store: KeyValueStore) {}

  async load(): Promise<Settings> {
    return SettingsRepository.coerce(await this.store.get(STORAGE_KEYS.settings));
  }

  async save(settings: Settings): Promise<Settings> {
    const valid = settingsSchema.parse(settings);
    await this.store.set(STORAGE_KEYS.settings, valid);
    return valid;
  }

  async update(patch: Partial<Omit<Settings, 'version'>>): Promise<Settings> {
    return this.save({ ...(await this.load()), ...patch });
  }

  subscribe(listener: (settings: Settings) => void): () => void {
    return this.store.subscribe(STORAGE_KEYS.settings, (value) =>
      listener(SettingsRepository.coerce(value)),
    );
  }

  static coerce(raw: unknown): Settings {
    const whole = settingsSchema.safeParse(raw);
    if (whole.success) return whole.data;
    if (typeof raw !== 'object' || raw === null) return structuredClone(DEFAULT_SETTINGS);
    // Keep each stored field that is still valid; default the rest.
    const merged: Record<string, unknown> = structuredClone(DEFAULT_SETTINGS);
    const record = raw as Record<string, unknown>;
    for (const key of Object.keys(settingsSchema.shape) as (keyof Settings)[]) {
      if (key === 'version') continue;
      const field = settingsSchema.shape[key].safeParse(record[key]);
      if (field.success) merged[key] = field.data;
    }
    return settingsSchema.parse(merged);
  }
}
