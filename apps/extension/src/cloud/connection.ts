import { z } from 'zod';
import { STORAGE_KEYS } from '@applypilot/shared';
import type { KeyValueStore } from '../storage/storage-area';

/**
 * Where ApplyPilot Cloud lives, and whether this browser syncs with it.
 * Off until the user sets it up. The addresses come from the CDK deployment's
 * outputs (or the local test server); nothing here is secret.
 */

const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/;

export const cloudConnectionSchema = z.object({
  apiUrl: z
    .string()
    .trim()
    .refine(
      (v) =>
        LOCAL.test(v) ||
        /^https:\/\/[a-z0-9]+\.execute-api\.[a-z0-9-]+\.amazonaws\.com\/[A-Za-z0-9_-]+$/.test(v),
      'Use the ApiUrl from the deployment (https://….execute-api.<region>.amazonaws.com/prod), or the local test server.',
    ),
  authUrl: z
    .string()
    .trim()
    .refine(
      (v) =>
        LOCAL.test(v) || /^https:\/\/[a-z0-9-]+\.auth\.[a-z0-9-]+\.amazoncognito\.com$/.test(v),
      'Use the AuthUrl from the deployment (https://<prefix>.auth.<region>.amazoncognito.com), or the local test server.',
    ),
  clientId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,128}$/, 'Use the ClientId from the deployment.'),
});
export type CloudConnection = z.infer<typeof cloudConnectionSchema>;

export const cloudSettingsSchema = z.object({
  connection: cloudConnectionSchema.nullable(),
  /** Sync runs only when this is on and the user is signed in. */
  syncEnabled: z.boolean(),
});
export type CloudSettings = z.infer<typeof cloudSettingsSchema>;

export const DEFAULT_CLOUD_SETTINGS: CloudSettings = { connection: null, syncEnabled: false };

/** The local test server started with "pnpm cloud:local". */
export const LOCAL_TEST_CONNECTION: CloudConnection = {
  apiUrl: 'http://127.0.0.1:8788',
  authUrl: 'http://127.0.0.1:8788',
  clientId: 'applypilot-local-client',
};

/** Host permission patterns Chrome needs for a connection (requested from a click). */
export function connectionOrigins(connection: CloudConnection): string[] {
  const patterns = [connection.apiUrl, connection.authUrl].map((address) => {
    const url = new URL(address);
    return `${url.protocol}//${url.hostname}/*`;
  });
  return [...new Set(patterns)];
}

export const isLocalConnection = (connection: CloudConnection) => LOCAL.test(connection.apiUrl);

export class CloudSettingsRepository {
  constructor(private readonly store: KeyValueStore) {}

  async load(): Promise<CloudSettings> {
    const parsed = cloudSettingsSchema.safeParse(await this.store.get(STORAGE_KEYS.cloud));
    return parsed.success ? parsed.data : { ...DEFAULT_CLOUD_SETTINGS };
  }

  async save(settings: CloudSettings): Promise<CloudSettings> {
    const valid = cloudSettingsSchema.parse(settings);
    await this.store.set(STORAGE_KEYS.cloud, valid);
    return valid;
  }

  subscribe(listener: (settings: CloudSettings) => void): () => void {
    return this.store.subscribe(STORAGE_KEYS.cloud, (value) => {
      const parsed = cloudSettingsSchema.safeParse(value);
      listener(parsed.success ? parsed.data : { ...DEFAULT_CLOUD_SETTINGS });
    });
  }
}
