import { DEFAULT_SETTINGS, STORAGE_KEYS } from '@applypilot/shared';
import { ApplicationsRepository } from '../storage/applications-repository';
import { SettingsRepository } from '../storage/settings-repository';
import { chromeStore } from '../storage/storage-area';
import { CloudAuth } from '../cloud/auth';
import { CloudSettingsRepository } from '../cloud/connection';
import { ExtensionLocalData } from '../cloud/local-data';
import { isSyncRequest, syncRequestSchema } from '../cloud/messages';
import { SyncRunner } from '../cloud/runner';
import { SyncStateRepository, SyncStatusRepository } from '../cloud/sync-store';
import { refreshFollowUpBadge } from './reminders';
import { handleBackgroundMessage, type BackgroundDeps } from './router';

const local = chromeStore('local');
const settings = new SettingsRepository(local);
const applications = new ApplicationsRepository(local);
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

// Follow-up reminders: the toolbar badge counts follow-ups due today or earlier.
// It is refreshed when the tracker changes, when the browser starts, and hourly
// so a reminder appears on its day without the panel being opened.
const FOLLOW_UP_ALARM = 'applypilot-follow-ups';
const refreshBadge = () =>
  void refreshFollowUpBadge(applications, {
    setText: (text) => chrome.action.setBadgeText({ text }),
    setColor: (color) => chrome.action.setBadgeBackgroundColor({ color }),
    setTitle: (title) => chrome.action.setTitle({ title }),
  }).catch((error: unknown) => console.error('[ApplyPilot] follow-up badge failed', error));
void chrome.alarms.create(FOLLOW_UP_ALARM, { periodInMinutes: 60, delayInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FOLLOW_UP_ALARM) refreshBadge();
});
chrome.runtime.onStartup.addListener(refreshBadge);
local.subscribe(STORAGE_KEYS.applications, refreshBadge);
refreshBadge();

// Cached analyses are per page load: drop them on navigation, on in-page address
// changes (Indeed switches the selected job that way) and on tab close.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' || changeInfo.url !== undefined)
    void session.remove(cacheKey(tabId));
});
chrome.tabs.onRemoved.addListener((tabId) => void session.remove(cacheKey(tabId)));

// Optional cloud sync (Phase 6). Off until the user connects, signs in and
// turns it on. It runs every 15 minutes and shortly after local edits.
const cloudSettings = new CloudSettingsRepository(local);
const sync = new SyncRunner({
  settings: cloudSettings,
  auth: new CloudAuth({ session, identity: chrome.identity }),
  local: new ExtensionLocalData(local),
  state: new SyncStateRepository(local),
  status: new SyncStatusRepository(local),
});
const SYNC_ALARM = 'applypilot-sync';
const SYNC_SOON_ALARM = 'applypilot-sync-soon';
void chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 15, delayInMinutes: 1 });
// Edits schedule a sync only when sync is on, so the worker is not woken for nothing.
const syncSoon = () =>
  void cloudSettings.load().then((s) => {
    if (s.syncEnabled) void chrome.alarms.create(SYNC_SOON_ALARM, { delayInMinutes: 0.5 });
  });
void sync.recoverInterrupted();
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM || alarm.name === SYNC_SOON_ALARM) {
    void sync
      .runIfEnabled()
      .catch((error: unknown) => console.error('[ApplyPilot] sync failed', error));
  }
});
local.subscribe(STORAGE_KEYS.profile, syncSoon);
local.subscribe(STORAGE_KEYS.applications, syncSoon);

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
  if (isSyncRequest(message)) {
    const request = syncRequestSchema.safeParse(message);
    if (!request.success) {
      sendResponse({
        ok: false,
        error: { code: 'INVALID_MESSAGE', message: 'Malformed sync request.' },
      });
      return false;
    }
    sync
      .handle(request.data)
      .then(sendResponse)
      .catch((error: unknown) => {
        console.error('[ApplyPilot] sync request failed', error);
        sendResponse({
          ok: false,
          error: { code: 'INTERNAL', message: 'Sync failed unexpectedly.' },
        });
      });
    return true;
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
