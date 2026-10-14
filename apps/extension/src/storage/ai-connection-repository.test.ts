import { describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '@applypilot/shared';
import {
  AiConnectionRepository,
  DEFAULT_AI_CONNECTION,
  apiUrlSchema,
  isConfigured,
  permissionOrigin,
} from './ai-connection-repository';
import { memoryStore } from './storage-area';

describe('AiConnectionRepository', () => {
  it('defaults to the local API with no token', async () => {
    const repo = new AiConnectionRepository(memoryStore());
    const connection = await repo.load();
    expect(connection).toEqual(DEFAULT_AI_CONNECTION);
    expect(isConfigured(connection)).toBe(false);
  });

  it('saves a valid connection and falls back to defaults on corrupt data', async () => {
    const store = memoryStore();
    const repo = new AiConnectionRepository(store);
    await repo.save({ apiUrl: 'http://localhost:9000', token: ' abc ' });
    expect(await repo.load()).toEqual({ apiUrl: 'http://localhost:9000', token: 'abc' });
    await store.set(STORAGE_KEYS.aiConnection, { apiUrl: 'https://evil.example', token: 'x' });
    expect(await repo.load()).toEqual(DEFAULT_AI_CONNECTION);
  });

  it.each([
    ['http://127.0.0.1:8787', true],
    ['http://localhost:3000', true],
    ['https://127.0.0.1:8787', false],
    ['http://192.168.1.5:8787', false],
    ['http://127.0.0.1:8787/v1', false],
    ['http://127.0.0.1', false],
  ])('accepts only local API addresses: %s', (url, valid) => {
    expect(apiUrlSchema.safeParse(url).success).toBe(valid);
  });

  it('maps an address to the optional host permission in the manifest', () => {
    expect(permissionOrigin('http://127.0.0.1:8787')).toBe('http://127.0.0.1/*');
    expect(permissionOrigin('http://localhost:9000')).toBe('http://localhost/*');
  });
});
