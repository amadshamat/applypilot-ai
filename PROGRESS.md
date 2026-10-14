# Progress

_Last updated: 2026-10-14 (v0.2.0)_

## Current phase

**Phase 2 (Profile, resume parsing and matching): built and tested here, waiting for Muhaid's
manual test in Chrome.** Phase 3 will not start until Phase 2 is approved.

Phase 1 (Foundation) and the v0.1.1 Indeed fix are complete and were confirmed in Chrome.

## Completed and verified

### Phase 2 (v0.2.0)

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

## Test results (2026-10-14, v0.2.0, local container, Node 22.22, Chromium 141)

- `pnpm typecheck`: passes (6 projects)
- `pnpm lint`: 0 errors, 0 warnings
- `pnpm format:check`: passes
- `pnpm test`: **210 passed** (extension 48, job-extraction 74, resume-parser 44, matching 30, shared 14)
- `pnpm test:coverage`: 86.4% statements, 78.4% branches, 81.6% functions, 88.6% lines
- `pnpm build`: passes
- `pnpm test:e2e`: **8 passed** (2 new: upload the real PDF and DOCX in the built extension, save, reload, analyze a job and see a score); screenshot test skipped by default
- `pnpm audit --audit-level high`: passes. One **moderate** advisory (sprintf-js, via mammoth → argparse) is in mammoth's command-line tool only; it is not in the extension bundle (checked with `grep` on `dist`).

## Not yet verified

- Phase 2 in desktop Google Chrome by hand (checklist in `docs/INSTALL-CHROME.md`, section 6).
- Real-world resumes. The parser is tested on a generated PDF and DOCX and on varied text
  layouts. Two-column PDFs, tables and image-only (scanned) PDFs are known weak spots (see below).
- The real side panel container (e2e opens `sidepanel.html` as a tab).
- The GitHub Actions workflow (no repository yet).

## Under development

Nothing in progress. Waiting for Phase 2 approval.

## Known bugs and limitations

- **Fixed during Phase 2:** the profile editor showed an empty form after reopening the side
  panel, because a state updater read a "has unsaved edits" flag after it had changed. Found by
  the new e2e test, fixed, and covered by a regression test.
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

1. **Muhaid:** test v0.2.0 in Chrome with your own resume and approve Phase 2 (or report issues).
2. **Phase 3:** server-side Claude integration with prompt versioning and schema-validated
   outputs; AI-assisted resume tailoring and cover letters grounded only in the saved profile;
   optional AI fallback for resumes the deterministic parser struggles with (off unless
   **Allow AI processing** is on).
3. **Phase 4:** autofill preview and per-field approval.
4. **Phase 5:** application tracker and analytics.
5. **Phase 6:** AWS CDK stacks with a cost estimate. No deployment without approval.
6. **Phase 7:** accessibility audit, performance, Chrome Web Store preparation.
