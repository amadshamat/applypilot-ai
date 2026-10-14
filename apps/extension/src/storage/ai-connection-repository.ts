import { z } from 'zod';
import { STORAGE_KEYS } from '@applypilot/shared';
import type { KeyValueStore } from './storage-area';

/**
 * Where the ApplyPilot API runs and the access token for it. The token only
 * unlocks the user's own local API; the Claude API key never reaches the
 * extension. Phase 3 accepts local addresses only.
 */

export const DEFAULT_API_URL = 'http://127.0.0.1:8787';

export const apiUrlSchema = z
  .string()
  .trim()
  .regex(
    /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/,
    'Use the local API address, for example http://127.0.0.1:8787',
  );

export const aiConnectionSchema = z.object({
  apiUrl: apiUrlSchema,
  token: z.string().trim().max(200),
});
export type AiConnection = z.infer<typeof aiConnectionSchema>;

export const DEFAULT_AI_CONNECTION: AiConnection = { apiUrl: DEFAULT_API_URL, token: '' };

export function isConfigured(connection: AiConnection): boolean {
  return connection.token.length > 0;
}

/** The host permission pattern Chrome needs for the API address. */
export function permissionOrigin(apiUrl: string): string {
  return `http://${new URL(apiUrl).hostname}/*`;
}

export class AiConnectionRepository {
  constructor(private readonly store: KeyValueStore) {}

  async load(): Promise<AiConnection> {
    const parsed = aiConnectionSchema.safeParse(await this.store.get(STORAGE_KEYS.aiConnection));
    return parsed.success ? parsed.data : { ...DEFAULT_AI_CONNECTION };
  }

  async save(connection: AiConnection): Promise<AiConnection> {
    const valid = aiConnectionSchema.parse(connection);
    await this.store.set(STORAGE_KEYS.aiConnection, valid);
    return valid;
  }

  subscribe(listener: (connection: AiConnection) => void): () => void {
    return this.store.subscribe(STORAGE_KEYS.aiConnection, (value) => {
      const parsed = aiConnectionSchema.safeParse(value);
      listener(parsed.success ? parsed.data : { ...DEFAULT_AI_CONNECTION });
    });
  }
}
