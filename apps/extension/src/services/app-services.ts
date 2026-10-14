import { createContext, useContext } from 'react';
import type { BackgroundRequest, ResponseFor } from '@applypilot/shared';
import { SettingsRepository } from '../storage/settings-repository';
import { chromeStore, type KeyValueStore } from '../storage/storage-area';
import { sendToBackground } from './messaging';

/**
 * Browser-facing dependencies for the React tree. Production wires Chrome APIs;
 * tests pass fakes, so components never call `chrome.*` directly.
 */
export interface AppServices {
  settings: SettingsRepository;
  localStore: KeyValueStore;
  send: <R extends BackgroundRequest>(request: R) => Promise<ResponseFor<R['type']>>;
  getActiveTabId: () => Promise<number | null>;
  openOptionsPage: () => void;
}

export function createChromeServices(): AppServices {
  const localStore = chromeStore('local');
  return {
    settings: new SettingsRepository(localStore),
    localStore,
    send: (request) => sendToBackground(request),
    async getActiveTabId() {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab?.id ?? null;
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
