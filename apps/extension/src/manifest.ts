import pkg from '../package.json' with { type: 'json' };
import { INDEED_FRAMES_ORIGIN } from './lib/host-access';

/**
 * Hosts the e2e browser maps to the local fixture server: Indeed pages and
 * frames, and the sample application forms served under each platform's
 * hostname so platform detection is exercised. Test builds only.
 */
export const E2E_HOSTS = [
  'http://127.0.0.1/*',
  'http://www.indeed.com/*',
  'http://jobs.indeed.com/*',
  'http://smartapply.indeed.com/*',
  'http://job-boards.greenhouse.io/*',
  'http://jobs.lever.co/*',
  'http://jobs.ashbyhq.com/*',
  'http://jobs.smartrecruiters.com/*',
  'http://acme.wd5.myworkdayjobs.com/*',
] as const;

export interface ManifestOptions {
  /**
   * End-to-end test builds only: grants access to the local fixture server
   * (127.0.0.1, and the hostnames in E2E_HOSTS which the e2e browser maps to
   * it) so Playwright can exercise extraction and autofill without a toolbar
   * click. Never set for
   * release builds.
   */
  e2e: boolean;
}

/**
 * Manifest V3 definition. Permissions are deliberately minimal:
 * - `activeTab` + `scripting`: read the current page only after the user clicks
 *   the toolbar icon. No `<all_urls>` host access and no `tabs` permission, so
 *   the extension never sees browsing history.
 * - `sidePanel`: the main UI.
 * - `storage`: settings and local data.
 * - `alarms`: re-checks follow-up reminders once an hour to update the toolbar
 *   badge (Phase 5). No install warning; it wakes nothing but the extension.
 * - Optional host access to 127.0.0.1 / localhost, requested only when the
 *   user connects the local ApplyPilot API for AI features (Phase 3).
 */
export function createManifest({ e2e }: ManifestOptions): chrome.runtime.ManifestV3 {
  return {
    manifest_version: 3,
    name: 'ApplyPilot AI',
    short_name: 'ApplyPilot',
    version: pkg.version,
    description:
      'Apply smarter. Apply faster. Stay organized. A job application copilot that keeps you in control.',
    minimum_chrome_version: '116',
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    action: {
      default_title: 'Open ApplyPilot AI',
      default_icon: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png' },
    },
    side_panel: { default_path: 'sidepanel.html' },
    options_ui: { page: 'options.html', open_in_tab: true },
    background: { service_worker: 'background.js', type: 'module' },
    permissions: ['activeTab', 'alarms', 'scripting', 'sidePanel', 'storage'],
    // Indeed frames are requested only from the user's click when a job sits in
    // a frame on another Indeed subdomain (DECISIONS 037).
    optional_host_permissions: ['http://127.0.0.1/*', 'http://localhost/*', INDEED_FRAMES_ORIGIN],
    ...(e2e
      ? {
          host_permissions: [...E2E_HOSTS],
        }
      : {}),
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'self'; base-uri 'self'; frame-ancestors 'none'",
    },
    commands: {
      _execute_action: {
        suggested_key: { default: 'Alt+Shift+A' },
        description: 'Open ApplyPilot AI',
      },
    },
  };
}
