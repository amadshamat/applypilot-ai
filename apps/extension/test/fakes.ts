import { vi } from 'vitest';
import type { BackgroundRequest, ResponseFor } from '@applypilot/shared';
import type { AppServices } from '../src/services/app-services';
import { SettingsRepository } from '../src/storage/settings-repository';
import { memoryStore } from '../src/storage/storage-area';

type Handler = (request: BackgroundRequest) => unknown;

export function fakeServices(handler: Handler = () => ({ ok: true, data: null })) {
  const localStore = memoryStore();
  const send = vi.fn((request: BackgroundRequest) => Promise.resolve(handler(request)));
  const services: AppServices = {
    settings: new SettingsRepository(localStore),
    localStore,
    send: send as unknown as <R extends BackgroundRequest>(r: R) => Promise<ResponseFor<R['type']>>,
    getActiveTabId: () => Promise.resolve(7),
    openOptionsPage: vi.fn(),
  };
  return { services, send };
}
