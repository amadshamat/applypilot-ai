import { describe, expect, it } from 'vitest';
import { createManifest } from './manifest';

describe('manifest', () => {
  const release = createManifest({ e2e: false });

  it('requests only the permissions the features need', () => {
    expect([...(release.permissions ?? [])].sort()).toEqual([
      'activeTab',
      'alarms',
      'identity',
      'scripting',
      'sidePanel',
      'storage',
      'unlimitedStorage',
    ]);
    expect(release.host_permissions).toBeUndefined();
    expect(release.content_scripts).toBeUndefined();
  });

  it('asks for local API and cloud access only as optional permissions', () => {
    expect(release.optional_host_permissions).toEqual([
      'http://127.0.0.1/*',
      'http://localhost/*',
      'https://*.indeed.com/*',
      'https://*.amazonaws.com/*',
      'https://*.amazoncognito.com/*',
    ]);
  });

  it('keeps a strict extension-page CSP with no remote or eval code', () => {
    const csp = release.content_security_policy?.extension_pages ?? '';
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/unsafe-eval|unsafe-inline|https?:/);
  });

  it('limits the e2e build to the local fixture server', () => {
    const hosts = createManifest({ e2e: true }).host_permissions ?? [];
    expect(hosts).toContain('http://127.0.0.1/*');
    // Plain http on hostnames the e2e browser maps to 127.0.0.1; never https or wildcards.
    expect(hosts.every((h) => /^http:\/\/[a-z0-9.-]+\/\*$/.test(h))).toBe(true);
    expect(hosts).toHaveLength(9);
  });
});
