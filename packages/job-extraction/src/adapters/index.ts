import type { Platform } from '@applypilot/shared';
import type { SiteAdapter } from '../types';
import { greenhouseAdapter } from './greenhouse';

/** Adapters with dedicated, fixture-tested extraction. */
export const SITE_ADAPTERS: readonly SiteAdapter[] = [greenhouseAdapter];

const PLATFORM_HOSTS: ReadonlyArray<[Exclude<Platform, 'generic'>, RegExp]> = [
  ['greenhouse', /(^|\.)greenhouse\.io$/],
  ['lever', /^jobs\.(eu\.)?lever\.co$/],
  ['workday', /(^|\.)(myworkdayjobs|myworkdaysite)\.com$/],
  ['smartrecruiters', /^(jobs|careers)\.smartrecruiters\.com$/],
  ['ashby', /^jobs\.ashbyhq\.com$/],
];

/** Identifies the hosting platform from the hostname only. */
export function detectPlatform(url: URL): Platform {
  for (const [platform, pattern] of PLATFORM_HOSTS) {
    if (pattern.test(url.hostname)) return platform;
  }
  return 'generic';
}
