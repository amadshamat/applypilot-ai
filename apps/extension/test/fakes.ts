import { vi } from 'vitest';
import type { BackgroundRequest, ResponseFor } from '@applypilot/shared';
import type { AppServices } from '../src/services/app-services';
import type { AiClient } from '../src/services/ai-client';
import { AiConnectionRepository } from '../src/storage/ai-connection-repository';
import { AiDraftsRepository } from '../src/storage/ai-drafts-repository';
import { ProfileRepository } from '../src/storage/profile-repository';
import { memoryResumeStore } from '../src/storage/resume-store';
import { SettingsRepository } from '../src/storage/settings-repository';
import { memoryStore } from '../src/storage/storage-area';

type Handler = (request: BackgroundRequest) => unknown;

export interface FakeOptions {
  /** What the fake resume reader returns, or an Error to throw. */
  resumeText?: string | Error;
  /** AI client used by the AI features. Defaults to one that fails every call. */
  ai?: AiClient;
  /** Whether the optional host permission is granted, and what a request answers. */
  permission?: { granted: boolean; grantOnRequest: boolean };
}

const unavailableAi: AiClient = {
  health: () => Promise.reject(new Error('No fake AI client configured')),
  run: () => Promise.reject(new Error('No fake AI client configured')),
};

export function fakeServices(
  handler: Handler = () => ({ ok: true, data: null }),
  options: FakeOptions = {},
) {
  const localStore = memoryStore();
  const permission = { ...(options.permission ?? { granted: true, grantOnRequest: true }) };
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
    aiConnection: new AiConnectionRepository(localStore),
    aiDrafts: new AiDraftsRepository(localStore),
    ai: options.ai ?? unavailableAi,
    permissions: {
      contains: vi.fn(() => Promise.resolve(permission.granted)),
      request: vi.fn(() => {
        permission.granted = permission.grantOnRequest;
        return Promise.resolve(permission.granted);
      }),
    },
    send: send as unknown as <R extends BackgroundRequest>(r: R) => Promise<ResponseFor<R['type']>>,
    getActiveTabId: () => Promise.resolve(7),
    openOptionsPage: vi.fn(),
  };
  return { services, send };
}
