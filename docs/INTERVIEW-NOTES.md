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
