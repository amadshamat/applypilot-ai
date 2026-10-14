# Interview notes: Phase 1

Concepts you should be able to explain from this phase, with where they live in the code.

## Concepts

1. **Manifest V3 architecture.** Why the background is a service worker that can be suspended at
   any time, so state lives in `chrome.storage` and not in variables
   (`apps/extension/src/background/index.ts`).
2. **Least-privilege permissions.** `activeTab` versus host permissions, why the toolbar click
   opens the side panel itself, and why there are no declared content scripts
   (`src/manifest.ts`, DECISIONS 004 and 005).
3. **Message passing and trust boundaries.** Side panel, service worker and content script are
   separate contexts. Every message is validated with Zod because the content script runs inside
   a page you do not control (`packages/shared/src/schemas/messages.ts`, `router.ts`).
4. **Schema-first types.** Zod schemas as the single source of truth with inferred TypeScript
   types, and the `found`/`missing` discriminated union that stops "unknown" being treated as a
   value.
5. **Layered extraction.** JSON-LD, then site adapter, then content analysis, then page signals,
   with per-field precedence and validation (`packages/job-extraction/src/extract.ts`).
6. **Safe handling of untrusted HTML.** Parsing into inert documents so scripts never execute,
   and React's escaping for display (the "never executes scripts" test).
7. **Dependency injection for testability.** `BackgroundDeps` and `AppServices` let the same code
   run against Chrome in production and fakes in tests.
8. **Testing pyramid.** Unit tests on pure functions, integration tests on React views with fake
   services, and Playwright e2e that loads the real built extension into Chromium.
9. **Build tooling.** Why the content script is a separate IIFE bundle while pages and the
   service worker share ES module chunks.
10. **Honest engineering.** A bug found through e2e screenshots (generic extraction missed a
    description) fixed with a regression test, recorded in PROGRESS.md.

## Resume bullets (only what is built and verified)

- Built a Manifest V3 Chrome extension in TypeScript and React with a side panel UI, typed
  runtime-validated messaging (Zod), and least-privilege permissions (activeTab, no host access).
- Designed a layered job-posting extraction engine (schema.org JSON-LD, site adapters, DOM and
  text analysis) that records source and confidence for each of 16 fields and never guesses
  missing values.
- Set up a pnpm monorepo with strict TypeScript, type-aware ESLint, 83 Vitest tests and 5
  Playwright end-to-end tests that load the built extension into Chromium, plus a GitHub Actions
  pipeline with dependency auditing.

# Interview notes: Phase 2

## Concepts

1. **Parsing untrusted documents locally.** pdf.js text items carry positions, so lines are
   rebuilt from y coordinates and gaps (`packages/resume-parser/src/files.ts`); DOCX goes
   through mammoth's HTML so Word list items become bullets.
2. **Extension CSP and workers.** Why the pdf.js worker is a packaged file loaded by
   `chrome.runtime.getURL`, and why WASM is turned off (DECISIONS 019).
3. **Rule-based parsing with honest uncertainty.** Section headings, date ranges, role keywords;
   ambiguous cases become warnings, and a test checks every parsed value exists in the source.
4. **Human-in-the-loop data entry.** Parsed output is a draft; the user reviews, corrects and
   chooses merge or replace (DECISIONS 020).
5. **Storage choices.** chrome.storage for small, synced-across-pages state; IndexedDB for
   binary files; validation on write, corruption reported rather than repaired silently.
6. **Explainable scoring.** Weighted average over known components only, coverage reporting,
   evidence per skill, partial credit for related skills (DECISIONS 022, 023).
7. **Interval merging.** Total experience from overlapping date ranges (`experience.ts`).
8. **Property-style tests.** Determinism, monotonicity (adding a skill never lowers the score),
   and "unknown never counts as a match".
9. **A real bug found by e2e.** A React state updater read a ref after an effect had changed it,
   so a reopened profile looked empty; fixed by reading the ref before calling the updater.

## Resume bullets (only what is built and verified)

- Built on-device resume parsing for PDF (pdf.js) and DOCX (mammoth) in a Manifest V3 extension,
  turning resumes into an editable, schema-validated profile that the user reviews before saving.
- Designed an explainable job-match engine that scores a profile against extracted job
  requirements, cites the profile entry behind every matched skill, and excludes requirements a
  posting does not state instead of guessing.
- Grew the test suite to 210 Vitest tests and 8 Playwright tests, including end-to-end upload of
  real PDF and DOCX files inside the built extension.
