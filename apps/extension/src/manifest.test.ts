import { describe, expect, it } from 'vitest';
import { createManifest } from './manifest';

describe('manifest', () => {
  const release = createManifest({ e2e: false });

  it('requests only the permissions Phase 1 needs', () => {
    expect([...(release.permissions ?? [])].sort()).toEqual([
      'activeTab',
      'scripting',
      'sidePanel',
      'storage',
    ]);
    expect(release.host_permissions).toBeUndefined();
    expect(release.content_scripts).toBeUndefined();
  });

  it('keeps a strict extension-page CSP with no remote or eval code', () => {
    const csp = release.content_security_policy?.extension_pages ?? '';
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/unsafe-eval|unsafe-inline|https?:/);
  });

  it('limits the e2e build to the local fixture server', () => {
    expect(createManifest({ e2e: true }).host_permissions).toEqual([
      'http://127.0.0.1/*',
      'http://www.indeed.com/*',
    ]);
  });
});
