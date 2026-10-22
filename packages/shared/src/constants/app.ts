export const APP_NAME = 'ApplyPilot AI';
export const APP_TAGLINE = 'Apply smarter. Apply faster. Stay organized.';

export const APPLICATION_STAGES = [
  'saved',
  'preparing',
  'ready-to-apply',
  'applied',
  'assessment',
  'interview',
  'offer',
  'rejected',
  'withdrawn',
] as const;
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];

export const STORAGE_KEYS = {
  settings: 'applypilot.settings',
  profile: 'applypilot.profile',
  aiConnection: 'applypilot.aiConnection',
  aiDrafts: 'applypilot.aiDrafts',
  applications: 'applypilot.applications',
  /** Cloud sync connection and on/off choice (Phase 6). */
  cloud: 'applypilot.cloud',
  /** Sync bookkeeping: the cloud copy last seen for each item, open conflicts. */
  syncState: 'applypilot.syncState',
  /** The latest sync result, shown in Settings. */
  syncStatus: 'applypilot.syncStatus',
  /** Copies of local data taken before sync changed it. */
  syncBackups: 'applypilot.syncBackups',
  /** Sign-in tokens. In chrome.storage.session only: memory, never written to disk. */
  cloudSession: 'applypilot.cloudSession',
} as const;
