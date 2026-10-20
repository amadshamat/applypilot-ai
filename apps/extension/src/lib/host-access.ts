/** Optional access that lets ApplyPilot read Indeed job frames on other subdomains. */
export const INDEED_FRAMES_ORIGIN = 'https://*.indeed.com/*';

/** True when a blocked frame is on an Indeed site, so the optional access would help. */
export function isIndeedOrigin(origin: string): boolean {
  try {
    return /(^|\.)indeed\.com$/i.test(new URL(origin).hostname);
  } catch {
    return false;
  }
}
