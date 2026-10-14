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
} as const;
