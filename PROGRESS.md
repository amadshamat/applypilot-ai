# Progress

_Last updated: 2026-10-14 (v0.3.0)_

## Current phase

**Phase 3 (Claude integration, tailoring, cover letters, screening drafts): built and tested
here, waiting for Muhaid's manual test in Chrome.** Phase 4 will not start until Phase 3 is
approved. No real (paid) Claude request has been made; see "Not yet verified".

Phase 2 was approved by Muhaid on 2026-10-14 after manual testing in Google Chrome (resume
upload, profile management, persistence, job matching and suggestions). Phase 1 and the
v0.1.1 Indeed fix were confirmed earlier.

## Completed and verified

### Phase 3 (v0.3.0)

| Feature                                                                                                                                                                                                                                   | Verified by                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Local ApplyPilot API (`services/api`) on 127.0.0.1 holding the Claude key in a git-ignored `.env`; `pnpm api:setup` creates a random access token; free mock mode by default                                                              | `config.test.ts`, manual run with `curl`                                |
| API security: bearer token (constant-time), localhost-only Host header, `chrome-extension://` origins only, CORS and Private Network Access preflights, 300 KB body cap, daily limit, content-free logs                                   | `app.test.ts`, `http.test.ts` (real HTTP server)                        |
| Claude provider: official SDK, `claude-opus-5-5`, structured outputs from Zod schemas, adaptive thinking, effort `medium`, server-side `fallbacks: "default"`, refusal and `max_tokens` handling, typed errors, token and cost accounting | `anthropic.test.ts` (real SDK against a local fake of the Messages API) |
| Versioned prompts; job text fenced as untrusted data with fence-escape removal                                                                                                                                                            | `ai-core.test.ts`                                                       |
| Data minimisation: no contact details, links, GPA, preferences or salary; name only for cover letters; short refs instead of storage ids; exact JSON preview before sending                                                               | `ai-core.test.ts`, `test/ai.test.tsx`                                   |
| Grounding review of every draft: untraceable bullets, entries and skills removed; new numbers and skills flagged per bullet or paragraph                                                                                                  | `ai-core.test.ts`, `test/ai.test.tsx`                                   |
| Screening question classifier: legal, eligibility, demographic, attestation, pay, availability, relocation, references and contact questions are never sent (checked in the extension and again in the API)                               | `ai-core.test.ts`, `app.test.ts`, `test/ai.test.tsx`                    |
| AI Tailor view: consent gate, connection gate, profile and job gates; resume tailoring, cover letter (tone, length, notes, editable), screening drafts (editable, per-question badges); copy and download                                 | `test/ai.test.tsx`, e2e                                                 |
| Settings → AI connection: optional host permission requested on Connect, token saved, health check showing mock or Claude and today's usage                                                                                               | `test/ai.test.tsx`, e2e                                                 |
| Latest draft per task and job saved locally (max 30), validated and re-reviewed when shown; discard; included in export (token excluded) and in delete-all                                                                                | `ai-drafts-repository.test.ts`, `test/ai.test.tsx`, e2e                 |
| `pnpm check:bundle`: fails if an API key, `x-api-key`, the SDK or `api.anthropic.com` appears in the extension build                                                                                                                      | Run on the release build; confirmed it fails on a planted fake key      |

### Phase 2 (v0.2.0, approved in Chrome 2026-10-14)

| Feature                                                                                                                                                                                                                                                           | Verified by                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Profile model (Zod): personal details, summary, education, experience, skills, certifications, projects, job preferences; strict dates (`YYYY` / `YYYY-MM`) and `https` links                                                                                     | `packages/shared/test/profile.test.ts`                                                   |
| Profile stored in `chrome.storage.local`, validated on every write; corrupt data is reported, never silently overwritten                                                                                                                                          | `profile-repository.test.ts`                                                             |
| Profile editor: add, edit, reorder, delete entries in every section, field-level validation messages, explicit Save and Discard, follows saves from other pages without overwriting unsaved edits                                                                 | `test/profile.test.tsx`                                                                  |
| Resume upload (PDF, DOCX; 5 MB; drag and drop or file picker), read locally with pdf.js (worker shipped in the extension, WASM off) and mammoth                                                                                                                   | `files.test.ts` with real PDF and DOCX fixtures; e2e in Chromium under the extension CSP |
| Deterministic resume parser: sections, contact details, education (degree, field, dates, GPA, coursework), experience (role, employer, location, dates, bullets, technologies), skills with categories, projects, certifications; warnings for anything uncertain | `parse.test.ts`, `dates.test.ts` (includes a "never invents content" test)               |
| Review screen: every parsed field is editable before saving; choose "Add what's new" (merge, de-duplicated, never overwrites typed data) or "Replace my profile" (keeps job preferences)                                                                          | `merge.test.ts`, `test/profile.test.tsx`                                                 |
| Resume history in IndexedDB: original file kept unchanged, re-review, download, delete with confirmation                                                                                                                                                          | `resume-store.test.ts` (fake-indexeddb), `test/profile.test.tsx`, e2e                    |
| Explainable 0–100 match score using the Settings weights; parts the posting does not state are left out and reported as coverage                                                                                                                                  | `packages/matching/test/match.test.ts`                                                   |
| Skill evidence: every matched skill points to the profile entry that shows it; related skills (for example AWS for Amazon EC2) get half credit; "one of Python, Go or Java" counts as one requirement                                                             | `match.test.ts`, `integration.test.ts` (parsed resume against extracted fixture jobs)    |
| Experience years from dated roles (overlaps counted once, year-only dates read conservatively); education level including degrees in progress; job preferences                                                                                                    | `match.test.ts`                                                                          |
| Requirements that need a person (work authorization, soft skills) listed under "Check these yourself", never scored                                                                                                                                               | `match.test.ts`                                                                          |
| Truthful suggestions: list skills your experience already shows, show listed skills in context, reorder skills, lead with the most relevant project, add real numbers only if you have them, missing skills framed as "only if true"                              | `suggestions.test.ts`                                                                    |
| Match card in the Analyze view, with a "Build your profile" prompt when the profile is empty                                                                                                                                                                      | `test/profile.test.tsx`, `sidepanel.test.tsx`, e2e                                       |
| Data export includes resume metadata and parsed text; "Delete all local data" also removes the profile and resumes                                                                                                                                                | `sidepanel.test.tsx`                                                                     |

### Phase 1 and v0.1.1

| Feature                                                                                                    | Verified by                                                     |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| pnpm monorepo with strict TypeScript                                                                       | `pnpm typecheck`                                                |
| MV3 manifest from typed source; minimal permissions; strict CSP                                            | `manifest.test.ts`, Chrome (Muhaid)                             |
| Service worker, typed message router, per-tab session cache                                                | `router.test.ts`, e2e                                           |
| Side panel navigation, error boundary, loading/empty/error states                                          | `sidepanel.test.tsx`, e2e                                       |
| Settings (theme, AI consent off by default, analysis caching, match weights totalling 100)                 | `sidepanel.test.tsx`, e2e                                       |
| Job extraction: JSON-LD, Greenhouse and Indeed adapters, generic analysis, per-field source and confidence | `extract.test.ts`, `indeed.test.ts`, Chrome on Indeed (Muhaid)  |
| CI workflow                                                                                                | `.github/workflows/ci.yml` (written, **not yet run on GitHub**) |

## Test results (2026-10-14, v0.3.0, local container, Node 22.22, Chromium 141)

- `pnpm verify` (typecheck, lint, format check, tests, build, bundle check): passes
- `pnpm test`: **328 passed** (extension 81, job-extraction 74, resume-parser 44, ai-core 43,
  api 42, matching 30, shared 14)
- `pnpm test:coverage`: 87.4% statements, 78.8% branches, 84.2% functions, 89.1% lines
- `pnpm test:e2e`: **9 passed**, including the new AI flow: upload a resume, analyze a job, give
  consent, connect to the real local API (mock mode), generate a tailored resume, cover letter
  and screening answer, reload and see the saved draft. Screenshot test skipped by default.
- `pnpm audit --audit-level high`: passes. One **moderate** advisory (sprintf-js, via mammoth →
  argparse) is in mammoth's command-line tool only and not in the extension bundle.

## Not yet verified

- **A real Claude request.** No paid call has been made. The request shape is verified against
  the real SDK and a fake API, but output quality, latency and actual cost per draft need
  Muhaid's own key and approval.
- Phase 3 in desktop Google Chrome by hand, including Chrome's permission prompt for
  127.0.0.1 (checklist in `docs/INSTALL-CHROME.md`, section 7).
- Running the local API on Windows or macOS (tested on Linux).

- Real-world resumes. The parser is tested on a generated PDF and DOCX and on varied text
  layouts. Two-column PDFs, tables and image-only (scanned) PDFs are known weak spots (see below).
- The real side panel container (e2e opens `sidepanel.html` as a tab).
- The GitHub Actions workflow (no repository yet).

## Under development

Nothing in progress. Waiting for Phase 3 approval.

## Known bugs and limitations

- **Fixed during Phase 2:** the profile editor showed an empty form after reopening the side
  panel, because a state updater read a "has unsaved edits" flag after it had changed. Found by
  the new e2e test, fixed, and covered by a regression test.
- AI drafts need the local API running on the same computer; there is no hosted service yet.
- Grounding catches new numbers and known skills, not every invented claim (for example numbers
  written as words, or a vague claim with neither). Every draft is shown for review.
- Text edited in the draft boxes is not saved; copy or download it.
- The screening classifier is keyword-based and errs toward "you answer"; it can mark a harmless
  question as one to answer yourself.
- Mock mode only reorders and quotes your text; it is for testing the flow, not for real drafts.
- Scanned (image-only) PDFs are rejected with an explanation; there is no OCR.
- Two-column PDF layouts can interleave lines from both columns. The review screen is where the
  user corrects this.
- Old `.doc` files are not supported (the message suggests saving as `.docx` or PDF).
- The resume parser recognises English section headings only.
- When neither part of a job header names a role ("Blue Harbor | Northwind"), the first part is
  taken as the role and a warning asks the user to check it.
- Skill matching uses the shared 53-entry vocabulary plus exact names the user typed; niche tools
  outside it are matched only by name.
- Year-only dates count as little experience as possible (2022–2023 counts as two months) so the
  score never inflates experience. Adding months gives an accurate number.
- Location is compared only when you list preferred locations; where you live is not treated as
  a preference.
- Lever, Workday, SmartRecruiters and Ashby still use generic extraction.

## Next recommended steps

1. **Muhaid:** test v0.3.0 in Chrome in mock mode (section 7 of the install guide), then decide
   whether to try real Claude drafts with your own Anthropic key (about $0.05–$0.25 per draft).
2. **Phase 3 follow-ups (optional, not built):** AI fallback for resumes the deterministic parser
   struggles with; prompt caching once real usage shows repeated prefixes.
3. **Phase 4:** autofill preview and per-field approval (will also read screening questions from
   the form instead of pasting).
4. **Phase 5:** application tracker and analytics.
5. **Phase 6:** AWS CDK stacks with a cost estimate (the API handler moves into Lambda). No
   deployment without approval.
6. **Phase 7:** accessibility audit, performance, Chrome Web Store preparation.
