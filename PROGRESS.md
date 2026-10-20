# Progress

_Last updated: 2026-10-20 (v0.3.4)_

## Current phase

**Phase 3 (Claude integration, tailoring, cover letters, screening drafts): built and tested
here, waiting for Muhaid's manual test in Chrome.** v0.3.1 to v0.3.4 fix Indeed extraction bugs
found during that test (below). Phase 4 will not start until Phase 3 is approved. No real (paid)
Claude request has been made; see "Not yet verified".

Phase 2 was approved by Muhaid on 2026-10-14 after manual testing in Google Chrome (resume
upload, profile management, persistence, job matching and suggestions). Phase 1 and the
v0.1.1 Indeed fix were confirmed earlier.

## Completed and verified

### v0.3.4: Indeed feed values from the selected card

Reported by Muhaid on 2026-10-20 with v0.3.3 on the live Indeed homepage feed: "Facility
Operations Runner" at CloudKitchens was found and every check passed (first confirmed live
success of the selected-job detection), but the location was "Not found", the job type said
Part-time while the card says Full-time, and the pay had no currency.

| Fix                                                                                                                                    | Verified by                     |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Location, pay and job type the panel does not show are taken from the selected card, only when the card carries the same job id        | `indeed-selection.test.ts`, e2e |
| The card's job type chip (Indeed's own field) now wins over a mention in the description, and its pay gets the country site's currency | `indeed-selection.test.ts`, e2e |

The panel's live markup is still unknown; the new fixture models it from Muhaid's screenshot.

### v0.3.3: Indeed job details in a frame on another origin

Reported by Muhaid on 2026-10-20 (tested with v0.3.1): on an Indeed search page with "Server /
Bartender" at PaperMoon Springfield open on the right, the analysis showed "Untitled position",
no company, location or salary, and "No job is open on this Indeed page."

**Cause (inferred, not seen live):** Indeed's live page could not be opened from the build
environment (its proxy blocks indeed.com), so the exact markup was not inspected. The fixtures
and the earlier fixes cover a details panel in the page and in a same-origin frame. The remaining
layout that produces exactly this result is a details frame whose document is on another origin:
the page sees it as an empty frame (`contentDocument` is null) and the toolbar click grants
access to the tab's own origin only. v0.3.3 fixes that case, falls back safely when Chrome still
blocks the frame, and records the page's structure (no content) in the bug report so the real
layout can be confirmed.

| Fix                                                                                                                                         | Verified by                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| The content script runs in every frame Chrome allows; a frame is read only when it shows the selected job's id, and its reply is re-checked | `router.test.ts`, e2e (real cross-origin frame)  |
| A blocked frame is reported by origin; the warning says so instead of "No job is open", and no value is guessed from the search page        | `indeed-frames.test.ts`                          |
| **Allow reading Indeed job details** asks for the optional `https://*.indeed.com/*` access from a click, then analyzes again                | `sidepanel.test.tsx`, `manifest.test.ts`         |
| **Paste the job instead**: the user's pasted text and title are analyzed, and nothing else is read                                          | `indeed-frames.test.ts`, `sidepanel.test.tsx`    |
| A frame filled by script (about:blank) is read instead of being treated as still loading                                                    | `indeed-frames.test.ts`                          |
| Pay inside the frame gets the country site's currency from the page that holds it (Chrome's ancestor origins)                               | `indeed-frames.test.ts`, e2e ("$15.54 – $17.29") |
| The bug-report copy includes a content-free outline of the page (element names, frames and whether each is readable, shadow roots)          | `indeed-frames.test.ts`                          |

### v0.3.2: Indeed homepage feed

Reported by Muhaid on 2026-10-15 with v0.3.1: on Indeed's homepage feed
(`indeed.com/?from=gnav-homepage…&vjk=…`, "Matches your preferences") the analysis said "No job
is open" and found nothing, although "Police Officer" at Fairfax County Police Department was
open on the right. v0.3.1 correctly refused to mix in other jobs, but the feed uses none of the
search page's hooks. The feed's real markup could not be inspected from here, so the fix does
not depend on Indeed's class names:

| Fix                                                                                                                                              | Verified by                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| The selected card is found by its job id in `data-jk` or in a job link (`jk=`); the panel is the heading outside the list with that card's title | `indeed-selection.test.ts`, e2e |
| A different card with the same title ("Police Officer" twice) is never taken for the panel                                                       | `indeed-selection.test.ts`      |
| Company from the `/cmp/` link; location and pay from the "Company • City, ST • $pay" line; description from the densest text block in the panel  | `indeed-selection.test.ts`, e2e |
| Pay with both thousands separators and cents ("$74,034.90 - $132,956.10 a year") is read, and cents are shown                                    | `text-signals.test.ts`, e2e     |
| When no panel is found, the bug-report copy now describes the page structure (job links, matching headings, frames, hooks) without page content  | `indeed-selection.test.ts`      |

### v0.3.1: Indeed reads only the selected job

Reported by Muhaid on 2026-10-15: on an Indeed search page the analysis showed the title "Job
Search | Indeed", no company, the location of another result card ("Z S Connections …
Alexandria, VA 22314") and "no job is selected", while the selected job was "FT Unarmed
Security Officer – $20.89/hr" at Sunstates Security. Cause: the selected job's details were not
where the adapter looked (the regression fixture renders them in a same-origin frame, as some
Indeed layouts do), and the extractor then read the whole search page. The old code reproduces
the reported values on the new fixture.

| Fix                                                                                                                                                                                                      | Verified by                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| The Indeed adapter locates the selected job's details panel (inline, or in Indeed's same-origin details frame) and every strategy reads only inside it; with no panel nothing is extracted from the page | `indeed-selection.test.ts`, e2e                            |
| The panel is checked against the selection (the `vjk` id, the frame's `jk`, or the highlighted card's title); a panel still showing the previous job is never read                                       | `indeed-selection.test.ts`, e2e                            |
| Waiting covers the details frame (its own mutations and load events), so a job switch is analyzed once the new job has loaded                                                                            | `indeed-selection.test.ts`, e2e                            |
| Search-page headings and titles ("Job Search \| Indeed", "… jobs in Alexandria, VA") are never used as a job title; search-page JSON-LD is ignored                                                       | `indeed-selection.test.ts`, `indeed.test.ts`               |
| Diagnostics: "How this was read" lists each self-check, lowers confidence when the panel cannot be confirmed, and copies a bug-report summary without job text                                           | `indeed-selection.test.ts`, `sidepanel.test.tsx`           |
| Switching jobs: the side panel and AI Tailor notice when the tab shows another job, block drafting from the old analysis and offer to analyze the new one; the tab cache is dropped on address changes   | `sidepanel.test.tsx`, `ai.test.tsx`, `router.test.ts`, e2e |
| AI drafts are keyed by job (the Indeed job id on Indeed), so two jobs from one search never share a draft                                                                                                | `ai.test.tsx`, `job-page.test.ts`                          |

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
| Job extraction: JSON-LD, Greenhouse and Indeed adapters, generic analysis, per-field source and confidence | `extract.test.ts`, `indeed.test.ts`, `indeed-selection.test.ts` |
| CI workflow                                                                                                | `.github/workflows/ci.yml` (written, **not yet run on GitHub**) |

## Test results (2026-10-20, v0.3.4, local container, Node 22.22, Chromium 141)

- `pnpm verify` (typecheck, lint, format check, tests, build, bundle check): passes
- `pnpm test`: **383 passed** (job-extraction 110, extension 96, resume-parser 44, ai-core 43,
  api 42, matching 30, shared 18)
- `pnpm test:coverage`: 88.0% statements, 80.3% branches, 84.8% functions, 89.8% lines
- `pnpm test:e2e`: **13 passed**. v0.3.4 adds the CloudKitchens feed page. v0.3.3 adds an Indeed search page whose details frame is on a
  second hostname (`jobs.indeed.com`, a separate origin the page cannot read); the extension reads
  the selected job from inside the frame (repeated 4 times with the frame-switch test, no flakes).
  v0.3.2 added the homepage feed. New: the reported Indeed page with the selected job in a
  details frame, then a switch to another job whose frame loads 0.8 s after the address changes
  (repeated 4 times, no flakes). Also the AI flow: upload a resume, analyze a job, give consent,
  connect to the real local API (mock mode), generate a tailored resume, cover letter and
  screening answer, reload and see the saved draft. Screenshot test skipped by default.
- `pnpm audit --audit-level high`: passes. One **moderate** advisory (sprintf-js, via mammoth →
  argparse) is in mammoth's command-line tool only and not in the extension bundle.

## Not yet verified

- **A real Claude request.** No paid call has been made. The request shape is verified against
  the real SDK and a fake API, but output quality, latency and actual cost per draft need
  Muhaid's own key and approval.
- Phase 3 in desktop Google Chrome by hand, including Chrome's permission prompt for
  127.0.0.1 (checklist in `docs/INSTALL-CHROME.md`, section 7).
- **The Indeed fixes (v0.3.1 to v0.3.3) on live Indeed.** They are tested on fixtures modeled on
  Indeed's markup, with the panel inline, in a same-origin frame and in a cross-origin frame.
  Indeed's live markup could not be inspected from here, so the cause of the PaperMoon report is
  inferred. If it still fails, "Copy details for a bug report" now includes the page's outline.
- Chrome's prompt for the optional Indeed access, by hand (automation cannot click it; the e2e
  build has the access granted up front).
- Running the local API on Windows or macOS (tested on Linux).

- Real-world resumes. The parser is tested on a generated PDF and DOCX and on varied text
  layouts. Two-column PDFs, tables and image-only (scanned) PDFs are known weak spots (see below).
- The real side panel container (e2e opens `sidepanel.html` as a tab).
- The GitHub Actions workflow (no repository yet).

## Under development

Nothing in progress. Waiting for Phase 3 approval.

## Known bugs and limitations

- **Fixed in v0.3.3:** an Indeed job shown in a frame on another origin was reported as "No job is
  open". If Chrome still blocks the frame (access declined), the user can paste the job.
- If a page puts the job inside a closed shadow root or a frame on a non-Indeed site, it cannot be
  read; pasting the job is the fallback.
- **Fixed in v0.3.1:** Indeed search pages mixed the page title and other result cards into the
  analysis when the selected job's panel was not found (see above).
- On Indeed, if a job is opened without a `vjk` id and no result card is highlighted, the panel
  cannot be cross-checked; the analysis says so and shows medium confidence.
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

1. **Muhaid:** load v0.3.4 (remove the old version first), re-check the PaperMoon search page,
   a job switch and the homepage feed (section 5a of the install guide, I1 to I7), then test Phase 3 in mock mode (section 7) and decide
   whether to try real Claude drafts with your own Anthropic key (about $0.05–$0.25 per draft).
2. **Phase 3 follow-ups (optional, not built):** AI fallback for resumes the deterministic parser
   struggles with; prompt caching once real usage shows repeated prefixes.
3. **Phase 4:** autofill preview and per-field approval (will also read screening questions from
   the form instead of pasting).
4. **Phase 5:** application tracker and analytics.
5. **Phase 6:** AWS CDK stacks with a cost estimate (the API handler moves into Lambda). No
   deployment without approval.
6. **Phase 7:** accessibility audit, performance, Chrome Web Store preparation.
