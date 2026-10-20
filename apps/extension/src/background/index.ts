import { DEFAULT_SETTINGS } from '@applypilot/shared';
import { SettingsRepository } from '../storage/settings-repository';
import { chromeStore } from '../storage/storage-area';
import { handleBackgroundMessage, type BackgroundDeps } from './router';

const settings = new SettingsRepository(chromeStore('local'));
const session = chromeStore('session');
const cacheKey = (tabId: number) => `job-analysis:${tabId}`;

const deps: BackgroundDeps = {
  version: chrome.runtime.getManifest().version,
  async getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id === undefined) return null;
    return tab.url ? { id: tab.id, url: tab.url } : { id: tab.id };
  },
  async injectContentScript(tabId) {
    try {
      // Frames Chrome does not let the extension read are skipped.
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ['content.js'],
      });
    } catch {
      // Some pages refuse an all-frames injection outright; the page alone still works.
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    }
  },
  sendToTab: (tabId, message, frameId) => chrome.tabs.sendMessage(tabId, message, { frameId }),
  async probeFrames(tabId) {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => window.__applyPilotProbe?.() ?? null,
    });
    return results.map(({ frameId, result }) => ({ frameId, result }));
  },
  cache: {
    get: (tabId) => session.get(cacheKey(tabId)),
    set: (tabId, result) => session.set(cacheKey(tabId), result),
  },
  shouldCache: async () => (await settings.load()).cacheAnalyses,
};

// Clicking the toolbar icon opens the side panel and grants activeTab for the
// current page. Handling the click ourselves (instead of openPanelOnActionClick)
// guarantees the click counts as the user gesture that grants access.
chrome.action.onClicked.addListener((tab) => {
  void chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  if (reason === 'install') void settings.save(DEFAULT_SETTINGS);
});

// Cached analyses are per page load: drop them on navigation, on in-page address
// changes (Indeed switches the selected job that way) and on tab close.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' || changeInfo.url !== undefined)
    void session.remove(cacheKey(tabId));
});
chrome.tabs.onRemoved.addListener((tabId) => void session.remove(cacheKey(tabId)));

const EXTENSION_ORIGIN = new URL(chrome.runtime.getURL('')).origin;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only this extension's own pages may call the background. Content scripts
  // share the extension id but run on web origins, so they are rejected here.
  if (
    sender.id !== chrome.runtime.id ||
    !sender.url ||
    new URL(sender.url).origin !== EXTENSION_ORIGIN
  ) {
    return false;
  }
  handleBackgroundMessage(message, deps)
    .then(sendResponse)
    .catch((error: unknown) => {
      console.error('[ApplyPilot] background handler failed', error);
      sendResponse({
        ok: false,
        error: { code: 'INTERNAL', message: 'Unexpected background error.' },
      });
    });
  return true; // keep the channel open for the async response
});
