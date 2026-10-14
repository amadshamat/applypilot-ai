import {
  PROFILE_VERSION,
  STORAGE_KEYS,
  profileContentSchema,
  profileSchema,
  type Profile,
  type ProfileContent,
} from '@applypilot/shared';
import type { KeyValueStore } from './storage-area';

export type ProfileLoad =
  | { status: 'empty' }
  | { status: 'ok'; profile: Profile }
  /** Stored data exists but fails validation. It is left untouched so nothing is lost silently. */
  | { status: 'corrupt'; raw: unknown };

/**
 * The user's profile in chrome.storage.local. Every write is validated, and
 * reads never "repair" data on their own: a corrupt profile is reported so the
 * user can export it or start over.
 */
export class ProfileRepository {
  constructor(
    private readonly store: KeyValueStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async load(): Promise<ProfileLoad> {
    return ProfileRepository.interpret(await this.store.get(STORAGE_KEYS.profile));
  }

  async save(content: ProfileContent): Promise<Profile> {
    const profile = profileSchema.parse({
      ...profileContentSchema.parse(content),
      version: PROFILE_VERSION,
      updatedAt: this.now().toISOString(),
    });
    await this.store.set(STORAGE_KEYS.profile, profile);
    return profile;
  }

  async clear(): Promise<void> {
    await this.store.remove(STORAGE_KEYS.profile);
  }

  subscribe(listener: (result: ProfileLoad) => void): () => void {
    return this.store.subscribe(STORAGE_KEYS.profile, (value) =>
      listener(ProfileRepository.interpret(value)),
    );
  }

  static interpret(raw: unknown): ProfileLoad {
    if (raw === undefined || raw === null) return { status: 'empty' };
    const parsed = profileSchema.safeParse(raw);
    return parsed.success ? { status: 'ok', profile: parsed.data } : { status: 'corrupt', raw };
  }
}
