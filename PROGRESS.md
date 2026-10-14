# Progress

_Last updated: 2026-10-14 (v0.1.1)_

## Current phase

**Phase 1 (Foundation): complete.** The first Phase 2 deliverable, job detection with a
generic parser and one ATS adapter, is also complete. The rest of Phase 2 has not started.

## Completed and verified

| Feature                                                                                                                                                                                                                                  | Verified by                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| pnpm monorepo (`apps/extension`, `packages/shared`, `packages/job-extraction`) with strict TypeScript                                                                                                                                    | `pnpm typecheck`                                                               |
| MV3 manifest generated from typed source; minimal permissions; strict CSP                                                                                                                                                                | `manifest.test.ts`, loads in Chromium 141                                      |
| Service worker: opens side panel on toolbar click, typed message router, per-tab session cache                                                                                                                                           | `router.test.ts`, e2e                                                          |
| Side panel: six-section ARIA tab navigation (click and keyboard), error boundary, loading/empty/error states                                                                                                                             | `sidepanel.test.tsx`, e2e                                                      |
| Design system: tokens for light/dark, Button, Card, Badge, Alert, Switch, Skeleton, EmptyState                                                                                                                                           | screenshots in `docs/screenshots`                                              |
| Settings (side panel and options page): theme, AI consent (default off), analysis caching, match weights that must total 100                                                                                                             | `sidepanel.test.tsx`, e2e (persists across pages)                              |
| Local data export (JSON) and confirmed deletion                                                                                                                                                                                          | `sidepanel.test.tsx`                                                           |
| Runtime-validated messaging with timeouts and typed errors                                                                                                                                                                               | `messaging.test.ts`, `schemas.test.ts`                                         |
| Job extraction: JSON-LD, Greenhouse and Indeed adapters, description section parsing, skills, experience, salary, arrangement, employment type, education, deadline, job ID, application-form detection, per-field source and confidence | `extract.test.ts`, `indeed.test.ts`, `text-signals.test.ts` against 6 fixtures |
| Bounded waiting for client-rendered pages (one throttled MutationObserver, hard timeout)                                                                                                                                                 | `wait.test.ts`                                                                 |
| End-to-end: built extension analyzes a fixture job page in real Chromium                                                                                                                                                                 | `tests/e2e/extension.spec.ts`                                                  |
| CI workflow: typecheck, lint, format, tests with coverage, build, e2e, dependency audit                                                                                                                                                  | `.github/workflows/ci.yml` (written, **not yet run on GitHub**)                |

## Test results (2026-10-14, v0.1.1, local container, Node 22.22, Chromium 141)

- `pnpm typecheck`: passes (4 projects)
- `pnpm lint`: 0 errors, 0 warnings (typescript-eslint strict type-checked)
- `pnpm format:check`: passes
- `pnpm test`: **112 passed** (extension 31, job-extraction 74, shared 7)
- `pnpm test:coverage`: 83.5% statements, 77.4% branches, 82.5% functions, 86.3% lines
- `pnpm build`: passes
- `pnpm test:e2e`: **6 passed** (1 screenshot-capture test skipped by default)
- `pnpm audit --audit-level high`: no known vulnerabilities

## Not yet verified

- Loading the extension in desktop Google Chrome by hand (tested only in Playwright's Chromium 141). Guide and checklist: `docs/INSTALL-CHROME.md`.
- The real side panel container: e2e tests open `sidepanel.html` as a tab because Playwright
  cannot click the toolbar icon. `chrome.sidePanel.open()` on toolbar click is untested.
- The Indeed adapter on live Indeed pages. It is tested against fixtures modeled on Indeed's
  markup and in Chromium with the fixture served under Indeed's hostname; the environment that
  builds the extension cannot reach indeed.com.
- The Greenhouse adapter against live Greenhouse pages (tested against a fixture modeled on
  public markup).
- The GitHub Actions workflow (no repository exists yet).

## Under development

Nothing in progress.

## Known bugs and limitations

- **Fixed in v0.1.1 (found in real-world testing on Indeed):** the analyzer showed the account
  greeting ("Hello, …") as the job title, found no company, mixed company text into the location,
  missed "From $20 an hour" pay and kept only one of "Part-time, Full-time". Causes: no Indeed
  adapter, so the first `h1` on the page won; single-amount pay was not parsed; employment type
  held one value. Fixes: an Indeed adapter scoped to the selected job, generic title and location
  lookups that skip site headers and greetings, single-amount pay parsing, and employment type as
  a list. Covered by `packages/job-extraction/test/indeed.test.ts`, a side panel test, and an e2e
  test.

- Fixed during this phase: Greenhouse-style markup on an unknown host produced no description
  because generic selectors missed `job__description`. A low-confidence `[class*=description]`
  selector and a densest-text fallback were added, with a regression test.
- Lever, Workday, SmartRecruiters and Ashby are detected but have no adapter.
- Skill vocabulary is fixed (53 entries).
- Analysis needs a toolbar click on each tab (by design: no broad host permissions).

## Next recommended steps

1. **Phase 2:** profile schema and editor (React Hook Form + Zod), IndexedDB repository,
   resume upload with PDF (pdf.js) and DOCX (mammoth) parsing reviewed before saving, resume
   versions, deterministic explainable match score using the configured weights, Lever adapter.
2. **Phase 3:** local API service with a provider-agnostic Claude client, prompt versioning,
   schema-validated outputs, tailoring, cover letters and screening answers.
3. **Phase 4:** field classification, autofill preview and approval, mock application forms.
4. **Phase 5:** application tracker, analytics, CSV export, follow-ups.
5. **Phase 6:** CDK stacks for API Gateway, Lambda, DynamoDB, Cognito, CloudWatch with cost
   estimate. No deployment without approval.
6. **Phase 7:** accessibility audit, performance, Chrome Web Store preparation.
