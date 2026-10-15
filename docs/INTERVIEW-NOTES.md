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

# Interview notes: Phase 3

## Concepts

1. **Keeping secrets off the client.** A browser extension cannot hide a key, so the Claude key
   lives in a local API (`services/api`), the extension holds only a revocable access token, and
   `pnpm check:bundle` fails the build if a key pattern or direct Claude call appears in it.
2. **Securing a localhost service.** Binding to 127.0.0.1, Host header checks against DNS
   rebinding, an origin allowlist (only `chrome-extension://`), a constant-time token compare,
   body caps and a daily limit (`http.ts`, `app.ts`).
3. **Structured outputs.** The task's Zod schema becomes the JSON schema Claude must follow
   (`betaZodOutputFormat`), then both the API and the extension validate again. Business rules
   live in code, not in the schema.
4. **Grounding / hallucination control.** Every rewritten bullet must cite the original bullets
   it came from; the extension checks numbers and skills against the source and removes what
   cannot be traced (`grounding.ts`). The model is asked to be truthful, and code checks it.
5. **Prompt injection.** Job pages are untrusted. They are fenced and labelled as data, fence
   tags inside them are stripped, the model's output cannot trigger any action, and its output
   is constrained to a schema.
6. **Data minimisation.** Only what each task needs is sent; contact details never are; entries
   are referenced by short refs so storage ids stay local (`context.ts`).
7. **Human-in-the-loop safety rules.** Sensitive questions are classified locally and never
   reach the model, with a second filter in the API (`screening.ts`).
8. **Provider abstraction and testing without paid calls.** A mock provider for development and
   e2e, and the real SDK tested against a local fake of the Messages API to verify the exact
   request (model, effort, thinking, fallbacks, schema).
9. **Cost control.** Token accounting and cost on every draft, a worst-case estimate before
   sending, per-task output ceilings, and a daily cap.
10. **Lambda-ready design.** The API is a pure `(request) => response` function; only the thin
    HTTP adapter is Node-specific.

## Resume bullets (only what is built and verified)

- Integrated the Claude API through a local Node.js service that keeps the API key server-side,
  with structured JSON outputs, versioned prompts, typed error handling and per-request cost
  accounting.
- Built AI resume tailoring, cover letters and screening-answer drafts with deterministic
  grounding checks that remove untraceable content and flag new numbers or skills, so drafts
  stay truthful to the user's own profile.
- Hardened a localhost API against DNS rebinding, cross-origin access and prompt injection, and
  kept legal, eligibility and demographic questions away from the model entirely.
- Tested the AI flow without paid calls: 330+ unit and integration tests, the real SDK against a
  fake Messages API, and a Playwright test running the built extension against the real API in
  mock mode.

# Interview notes: v0.3.1 Indeed bug

## The story (a good "tell me about a bug" answer)

- **Symptom:** on an Indeed search page the analysis showed "Job Search | Indeed" as the title,
  no company, the location of a different result card, and "no job is selected".
- **Reproduce first:** wrote a fixture of that page with the selected job's details in a
  same-origin frame and ran the old code on it. It produced the same wrong location, which
  confirmed the cause before any fix.
- **Root cause:** when the adapter could not find the selected job, the extractor fell back to
  reading the whole page, so other jobs' data leaked in. The bug was the fallback, not one
  selector.
- **Fix:** adapters for multi-job pages return a scope (`locate()`), and every strategy is
  confined to it. The scope is cross-checked against the selection (job id, frame address, card
  title). No scope means no fields and a clear message. Waiting also watches the frame.
- **Second-order bug found while fixing:** Indeed switches jobs without a page load, so a cached
  analysis and AI drafts could describe the previous job. Analyses are now tied to a job identity.
- **Tests:** fixtures for inline and framed panels, switching between two jobs mid-load, a
  timeout, and a Playwright test in real Chromium that switches jobs while the frame is loading.

## Resume bullet

- Diagnosed and fixed a data-mixing bug in DOM extraction on dynamic job search pages by
  scoping extraction to the selected job (including same-origin iframes), cross-checking it
  against the selection and adding self-check diagnostics, with regression tests in jsdom and
  real Chromium.
