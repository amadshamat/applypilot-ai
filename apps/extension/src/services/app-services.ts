import { createContext, useContext } from 'react';
import type { BackgroundRequest, ResponseFor } from '@applypilot/shared';
import {
  ResumeFileError,
  detectResumeType,
  extractResumeText,
} from '@applypilot/resume-parser/files';
import { AiConnectionRepository } from '../storage/ai-connection-repository';
import { AiDraftsRepository } from '../storage/ai-drafts-repository';
import { ApplicationsRepository } from '../storage/applications-repository';
import { ProfileRepository } from '../storage/profile-repository';
import { indexedDbResumeStore, type ResumeStore } from '../storage/resume-store';
import { SettingsRepository } from '../storage/settings-repository';
import { chromeStore, type KeyValueStore } from '../storage/storage-area';
import { createAiClient, type AiClient } from './ai-client';
import { sendToBackground } from './messaging';

/** Reads the text out of an uploaded resume file. Swapped for a fake in tests. */
export type ResumeTextReader = (file: File) => Promise<string>;

/** Optional host permissions, requested at runtime from a user gesture. */
export interface PermissionService {
  contains(origin: string): Promise<boolean>;
  request(origin: string): Promise<boolean>;
}

/**
 * Browser-facing dependencies for the React tree. Production wires Chrome APIs;
 * tests pass fakes, so components never call `chrome.*` directly.
 */
export interface AppServices {
  settings: SettingsRepository;
  profile: ProfileRepository;
  resumes: ResumeStore;
  readResumeText: ResumeTextReader;
  localStore: KeyValueStore;
  aiConnection: AiConnectionRepository;
  aiDrafts: AiDraftsRepository;
  applications: ApplicationsRepository;
  ai: AiClient;
  permissions: PermissionService;
  send: <R extends BackgroundRequest>(request: R) => Promise<ResponseFor<R['type']>>;
  getActiveTabId: () => Promise<number | null>;
  /** The active tab's address, or null when the extension may not see it. */
  getActiveTabUrl: () => Promise<string | null>;
  /**
   * Calls back whenever the active tab may show something new: an address
   * change (including in-page changes such as picking another Indeed job), a
   * tab switch, or the panel regaining focus. Returns an unsubscribe function.
   */
  watchActiveTab: (onChange: () => void) => () => void;
  openOptionsPage: () => void;
}

/** pdf.js and mammoth are large; extractResumeText loads them only when a resume is uploaded. */
const readResumeText: ResumeTextReader = async (file) => {
  const type = detectResumeType(file.name, file.type);
  if (!type) throw new ResumeFileError('Only PDF and Word (.docx) files are supported.');
  return extractResumeText(await file.arrayBuffer(), type, {
    pdfWorkerSrc: chrome.runtime.getURL('pdf.worker.min.mjs'),
  });
};

export function createChromeServices(): AppServices {
  const localStore = chromeStore('local');
  return {
    settings: new SettingsRepository(localStore),
    profile: new ProfileRepository(localStore),
    resumes: indexedDbResumeStore(),
    readResumeText,
    localStore,
    aiConnection: new AiConnectionRepository(localStore),
    aiDrafts: new AiDraftsRepository(localStore),
    applications: new ApplicationsRepository(localStore),
    ai: createAiClient(),
    permissions: {
      contains: (origin) => chrome.permissions.contains({ origins: [origin] }),
      request: (origin) => chrome.permissions.request({ origins: [origin] }),
    },
    send: (request) => sendToBackground(request),
    async getActiveTabId() {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab?.id ?? null;
    },
    async getActiveTabUrl() {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab?.url ?? null;
    },
    watchActiveTab(onChange) {
      const onUpdated = (_id: number, change: chrome.tabs.OnUpdatedInfo) => {
        if (change.url !== undefined || change.status === 'complete') onChange();
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
      chrome.tabs.onActivated.addListener(onChange);
      window.addEventListener('focus', onChange);
      return () => {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        chrome.tabs.onActivated.removeListener(onChange);
        window.removeEventListener('focus', onChange);
      };
    },
    openOptionsPage: () => void chrome.runtime.openOptionsPage(),
  };
}

export const ServicesContext = createContext<AppServices | null>(null);

export function useServices(): AppServices {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('useServices must be used inside <ServicesProvider>');
  return services;
}
