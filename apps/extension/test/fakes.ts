import { vi } from 'vitest';
import type { BackgroundRequest, ResponseFor } from '@applypilot/shared';
import type { AppServices } from '../src/services/app-services';
import { ProfileRepository } from '../src/storage/profile-repository';
import { memoryResumeStore } from '../src/storage/resume-store';
import { SettingsRepository } from '../src/storage/settings-repository';
import { memoryStore } from '../src/storage/storage-area';

type Handler = (request: BackgroundRequest) => unknown;

export interface FakeOptions {
  /** What the fake resume reader returns, or an Error to throw. */
  resumeText?: string | Error;
}

export function fakeServices(
  handler: Handler = () => ({ ok: true, data: null }),
  options: FakeOptions = {},
) {
  const localStore = memoryStore();
  const send = vi.fn((request: BackgroundRequest) => Promise.resolve(handler(request)));
  const services: AppServices = {
    settings: new SettingsRepository(localStore),
    profile: new ProfileRepository(localStore, () => new Date('2026-10-14T12:00:00Z')),
    resumes: memoryResumeStore(),
    readResumeText: vi.fn(() =>
      options.resumeText instanceof Error
        ? Promise.reject(options.resumeText)
        : Promise.resolve(options.resumeText ?? ''),
    ),
    localStore,
    send: send as unknown as <R extends BackgroundRequest>(r: R) => Promise<ResponseFor<R['type']>>,
    getActiveTabId: () => Promise.resolve(7),
    openOptionsPage: vi.fn(),
  };
  return { services, send };
}
