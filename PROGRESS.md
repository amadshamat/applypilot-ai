# Progress

_Last updated: 2026-10-28 (v0.9.0 approved)_

## Current phase

**Phase 6 (AWS cloud backend, optional sign-in and sync): implemented and automated-tested,
not manually verified or approved.** On 2026-10-25 Muhaid installed v0.6.0 and chose to skip
the manual cloud sync checklist for now. Cloud sync has passed only the automated tests listed
below; it has **not** passed Muhaid's manual testing. Nothing has been deployed to AWS, no AWS
account was created or used, and no paid service was called.

Work continues on the extension's local features, which need neither AWS nor the local cloud
server. Cloud sync stays off unless the user sets it up, so it does not affect them. Phase 7
has not started.

**v0.7.0 (Import data, Delete all and reminder fixes): implemented, automated-tested, and
partly tested by Muhaid in Chrome.** On 2026-10-26 Muhaid imported a backup into a separate
Chrome profile: the import finished, the profile and the original resume file were restored,
the Profile tab showed the restored information, and the downloaded resume opened correctly.
The rest of the v0.7.0 checklist has not been reported yet (see Not yet verified).

**v0.8.0 (Keep AI draft edits): autosave approved by Muhaid on 2026-10-26** for what was
tested in Chrome: AI Tailor connected to the local API in free mock mode, cover letter edits
saved automatically, the "All changes saved" indicator worked, and an edited cover letter was
still there after closing and reopening the extension. The other v0.8.0 checks have not been
reported (see Not yet verified).

**v0.9.0 (Smarter Application Autofill): manually tested and approved by Muhaid on
2026-10-28** on the conditional practice application: newly revealed fields were detected,
earlier edited values and selections were kept, newly detected questions started unticked,
approved Yes/No controls and dropdowns filled correctly, sensitive questions stayed locked, and
nothing was submitted or advanced. Live application sites have not been tried.

Phase 5 was approved on 2026-10-22, Phase 4 on 2026-10-22, Phase 3 on 2026-10-22, Phase 2 on
2026-10-14. Phase 1 and the v0.1.1 Indeed fix were confirmed earlier.

## Completed

### v0.9.0: Smarter Application Autofill (tested and approved by Muhaid on the practice form)

- **Newly revealed questions are found.** After every fill the panel scans the page again by
  itself (reading only) and lists questions the answers revealed. While a scan is on screen
  it also checks the page every 2.5 seconds, read-only and without injecting anything, and
  shows "New questions appeared on the page" for questions that load later, or "This tab
  shows another page now" after the user moves on.
- **Safe re-scan keeps reviewed answers.** "Scan for new questions" replaces "Scan again": a
  field still on the page keeps its ref, so typed values and ticks (and unticks) stay with it.
  A question whose wording changed, or a field copied from another (a cloned block), counts as
  new. When no reviewed field is left (the next step), the review starts fresh. "Start over"
  clears the review as before.
- **New questions wait for review.** Fields found by a re-scan are marked **New** and start
  unticked, even when the profile has an exact value; nothing new is filled until the user
  ticks it. Values the page already shows are not sent again.
- **Yes/No buttons and custom selection controls.** Questions answered with toggle buttons
  (`aria-pressed`), `role="radio"` buttons outside a radiogroup, or plain Yes/No buttons are
  now fields (control `button-group`) the user can answer and fill; ApplyPilot clicks only the
  chosen answer and checks that it stuck. Toolbars, tabs, Next/Submit and dropdown buttons are
  never treated as answers, and a Yes/No group without a label is only reported. ARIA
  listboxes, comboboxes and radiogroups work as before.
- **Sensitive questions stay locked, in both places.** Work authorization, sponsorship,
  salary, demographics (now also recognised by answers such as Male/Female/Non-binary), consent
  and other sensitive questions are locked in the review, and the fill step refuses them again
  from the page's current wording and answers, so a tampered or reworded instruction cannot
  fill them. The fill step now also refuses pay questions.
- **Mapping only from verified data.** Revealed fields use the same profile rules. A Yes/No
  question is answered only when the profile proves Yes (for example "Do you have a public
  GitHub profile?" with a GitHub link saved, or "Are you currently enrolled…" with a current
  education entry), and still needs review; ApplyPilot never answers No for the user.
- **Never submits or advances.** Unchanged: the submit guard, and no click on anything
  submit-like. The new tests count Next, Submit and form submit events and they stay at 0.

### v0.8.0: Keep AI draft edits (cover letter autosave tested and approved by Muhaid)

- **Edits are saved automatically.** Text typed into the cover letter, the tailored resume
  (now an editable text box under the review cards) and each screening answer is stored about
  0.6 seconds after typing stops, per part, next to the generated draft for that job. Each box
  shows "Saving…", then "All changes saved", and "Edited" while it differs from the generated
  text.
- **Survives closing, reloading and restarting.** Edits live in `chrome.storage.local` with the
  draft (keyed by task and job, as before). Pending text is also written synchronously to the
  page's own storage on every keystroke and stored when the panel is hidden or closed, so a
  change typed just before closing is not lost; the copy is cleared once stored and by Delete
  all local data.
- **Revert to generated text** appears while a part is edited and asks before discarding the
  edits.
- **No silent overwrite.** Generate again on an edited draft asks first; the edited version is
  then kept and **Restore my edited version** brings it back (and keeps the newer draft too, if
  that one was edited). Discard asks first when the draft has edits.
- An edit is stored only on the draft it was made for: if that draft was replaced or deleted
  meanwhile, the box says so instead of writing onto the new one. Writes to one draft run one
  after another, so two answers saved together are both kept.
- Autofill uses the edited cover letter when there is one.
- Edits travel with Export and Import data (Merge keeps the draft already here).
- **Hardening:** when Chrome reports the extension as newly installed, settings are reset to
  defaults only if none are saved. Found by the new restart test: Chrome reports an unpacked
  build loaded with `--load-extension` as installed on every start, which turned AI consent off.

### v0.7.0: Import data and two local fixes (automated-tested; import into a new profile tested by Muhaid)

- **Import data** (Settings → Your data): loads a file made by Export data, from 0.7.0 or from
  any earlier version.
  - The file is read as data only (JSON.parse, never evaluated). Every record is checked against
    the same schemas the extension uses for its own storage, unknown fields are dropped, and
    resume files must match their recorded size and look like a PDF or Word file. Damaged,
    unrelated, cut-short and newer-version files are refused with an explanation.
  - A preview lists what the file holds, what cannot be imported and why, and what each choice
    would do, before anything is written.
  - **Merge** (default) never changes or removes anything here: it adds missing tracked
    applications (skipping ones whose job is already tracked), AI drafts, resumes, and the
    profile only if there is none. **Replace** makes each part the file contains match the
    file, shows removals in red, downloads a backup of the current data first, and leaves parts
    the file lacks alone.
  - Both keep an in-browser copy of everything they could touch: **Undo last import** puts it
    back, and a failed write puts it back automatically.
  - The result lists what was restored, removed, skipped, and could not be imported.
  - The API access token, cloud sync settings and sync bookkeeping are never imported.
- **Export data** now writes a versioned backup (`format: applypilot-backup`, version 2) that
  includes the original resume files, so a backup restores everything. Exports from 0.6.1 and
  earlier have no resume files; importing one keeps the resume text in the profile and says the
  files were skipped.
- **Delete all local data** now also removes every cached page analysis from Chrome's session
  storage and what the open pages hold in memory. Other open ApplyPilot pages (the side panel
  and the options page) are told and reload their views, so deleted data does not reappear on a
  tab switch or when the panel is reopened.
- **Follow-up reminders**: the toolbar badge is refreshed by a one-off alarm just after local
  midnight, set again each time it fires, instead of hourly. A 6-hour alarm re-sets it if the
  clock or time zone changes. The service worker now wakes about 5 times a day instead of 24.

### v0.6.1: review fixes (automated-tested)

- A sync interrupted by Chrome (worker suspended or browser closed mid-run) could leave the
  status on "Syncing…" and the **Sync now** button disabled for good. The worker now clears a
  leftover "syncing" status when it starts, and the button no longer depends on it. Covered by
  a new runner test.
- With sync off, every profile or tracker edit still woke the service worker 30 seconds later
  for a sync that then did nothing. Edits now schedule a sync only when sync is on.
- The message after an edit during sync said "will try again shortly" although the next run is
  the 15-minute timer; it now says so.

### Phase 6 (v0.6.0): ApplyPilot Cloud on AWS (implemented and automated-tested; not manually verified, not approved, not deployed)

- **Infrastructure as code** (`infra/`, AWS CDK in TypeScript): DynamoDB (on-demand, encrypted,
  point-in-time recovery), Cognito user pool (Lite plan) with hosted sign-in, API Gateway REST
  API with a Cognito authorizer and throttling, three Lambda functions with one least-privilege
  role each, CloudWatch log retention and alarms, SNS alerts and a monthly AWS Budget, Secrets
  Manager for the Claude key (AI only), optional WAF. cdk-nag AWS Solutions checks pass.
- **Cloud API** (`services/api/src/cloud`): versioned `/v1` routes for profile, applications,
  status history, notes, follow-ups, sync, export and account deletion; zod validation shared
  with the extension; structured errors with request ids; per-user rate limits; logs without
  personal data; JWT verification on top of the API Gateway authorizer.
- **Sync** (`packages/sync`): three-way merge, conflicts parked for the user, versioned writes,
  deletion confirmations, backups before changes, cloud-reset detection.
- **Extension:** Settings > Cloud sync (optional): connect, sign in or create an account
  (PKCE through `chrome.identity`), sync on/off, Sync now, conflicts, deletion and reset
  prompts, export cloud data, delete cloud data, delete account, sign out, restore a backup.
  Sync runs in the service worker every 15 minutes and shortly after edits, only when on.
- **Local stand-ins** (`pnpm cloud:local`): the real cloud API with an in-memory DynamoDB
  (dynalite) and a local Cognito-like sign-in server, so everything is testable without AWS.
- New permissions: `identity` and `unlimitedStorage` (neither shows an install warning), plus
  optional host access to `*.amazonaws.com` and `*.amazoncognito.com`, requested only for the
  deployment the user connects to.
- Docs: [docs/AWS.md](docs/AWS.md) (architecture diagram, local testing, deployment, cost).

### Phase 5 (v0.5.0): application tracking and analytics

| Feature                                                                                                                                                                                                                                                                | Verified by                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Tracked applications stored as validated records in `chrome.storage.local` (`applypilot.applications`, up to 1,000); entries a later version wrote are kept untouched, not dropped                                                                                     | `applications.test.tsx` (repository), e2e (survives a new panel)     |
| Statuses: Saved, Preparing, Ready to apply, Applied, Assessment, Interview, Offer, Rejected, Withdrawn, with a dated status history                                                                                                                                    | `tracking.test.ts`, `applications.test.tsx`, e2e                     |
| **Save to tracker** under an analyzed job, with its title, company, location, pay, address and the match score at that moment; a job already tracked shows its status instead (duplicates found by posting identity, address, or company and title)                    | `applications.test.tsx`, e2e                                         |
| **I submitted it: mark as applied** after an autofill fill. ApplyPilot cannot know whether a form was sent, so it never marks anything applied by itself                                                                                                               | `applications.test.tsx`, e2e (practice form, 0 submit attempts)      |
| Add an application by hand (validated title and address), edit status, notes (add, delete), delete with confirmation                                                                                                                                                   | `applications.test.tsx`                                              |
| Filtering by status (all, open, closed, each stage), search across title, company, location and notes, "follow-up due", and sorting (updated, applied, follow-up, company)                                                                                             | `tracking.test.ts`, `applications.test.tsx`                          |
| Follow-up reminders: a date and note per application, "In 1 week", a "Follow-ups due" list with Done, a toolbar badge with the count (refreshed on change, at browser start and hourly via `alarms`), and a hint for applications quiet for two weeks (suggested only) | `tracking.test.ts`, `reminders.test.ts`, e2e (badge 1, then cleared) |
| Analytics from stored records only: totals, open, applied, response, interview and offer rates (shown as "No data" rather than 0% when nothing was applied for), median days to first answer, average match score, by status, per week, by platform                    | `tracking.test.ts`, `applications.test.tsx`, e2e                     |
| CSV export (UTF-8 with BOM, CRLF, RFC 4180 quoting); cells starting with `=`, `+`, `-`, `@`, tab or CR get an apostrophe, so a formula planted in a job title cannot run in a spreadsheet                                                                              | `tracking.test.ts`, `applications.test.tsx`, e2e (real download)     |
| Data controls: Export data includes the tracker; Delete all local data removes it                                                                                                                                                                                      | `sidepanel.test.tsx`                                                 |

### Phase 4 acceptance review (2026-10-22)

- **Verified live by Muhaid:** the v0.4.1 practice form
  (`tests/fixtures/applications/practice-application.html`) was scanned and the approved fields
  were filled correctly in Chrome. **Passed.**
- **Reviewed and covered by tests before this release:** sensitive questions locked in the
  review and never built into fill instructions; never clicking submit-like controls; page
  submits blocked while filling and the guard removed afterwards; refusing a tab that moved to
  another page; passwords never scanned; labels-only AI field matching that cannot return
  sensitive kinds (extension and API); validated messages at the service worker.
- **Gaps found and closed in v0.5.0:**
  1. The fill step trusted the page's ref attributes. A page script could copy a scanned
     field's ref onto a password, hidden or invisible input, or relabel a field as a work
     authorization question after the scan. The content script now re-checks every instruction
     at fill time and skips sensitive questions (by the instruction's label and the field's
     current label), password and hidden inputs, and text fields that are no longer visible.
     Defence in depth: the side panel never sends these. Test: `fill.test.ts`.
  2. A page script calling `submitButton.click()` during a fill was blocked by the guard but
     not covered by a test. Test added: `fill.test.ts`.
  3. The content script's own checks (answers only this extension, rejects malformed requests,
     never reads passwords) had no direct test. Test added: `content/index.test.ts`.
- **Still not verifiable here:** live application sites (all platforms stay experimental) and
  a real Claude request (needs Muhaid's key and approval).

### v0.4.1: practice form and two locking fixes

- Added `tests/fixtures/applications/practice-application.html`, a standalone practice form to
  open in Chrome (no submission address; `form-action 'none'` and a cancelled submit handler;
  submit attempts shown on the page). Covered by an e2e test.
- **Fixed:** a radio group inside a fieldset shared with other fields (legend "Eligibility")
  was named by the legend, so "Are you legally authorized to work…" was not recognised and was
  left unlocked as "not recognised", where the user could type a value. Legends now name a
  group only when the fieldset holds nothing else; otherwise the text before the first option
  is used. Regression test in `scan.test.ts`.
- **Fixed:** "Desired hourly pay" (and "expected hourly rate") was not recognised as a pay
  question. Regression tests in `ai-core.test.ts`.
- `file://` pages are still not supported (scan says "regular web pages (http or https)"); serve
  local forms from `http://127.0.0.1`.

### Phase 4 (v0.4.0): assisted autofill

Every platform is **experimental**: tested on sample forms written for this project and modeled
on each platform's public markup, not yet on a live application. Generic HTML forms with
standard controls are supported the same way.

| Feature                                                                                                                                                                                                                                                                                                                                                                                                                           | Verified by                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Form scan: the form with the most fields (never the search box), labels from `aria-labelledby`, `<label>`, `aria-label`, nearby text, groups and legends; sections; required marks; options; current values; open shadow roots; same-origin frames; page order                                                                                                                                                                    | `autofill/test/scan.test.ts`, `platforms.test.ts`                        |
| Controls: text, email, tel, url, number, date, month, textarea, select, radio groups (native and ARIA), checkboxes, checkbox groups, ARIA comboboxes and typeaheads, buttons that open a listbox, file inputs                                                                                                                                                                                                                     | `scan.test.ts`, `fill.test.ts`, `platforms.test.ts`, e2e                 |
| Skipped on purpose: passwords, read-only and disabled fields (counted), hidden fields and honeypots (ignored), CAPTCHAs (reported, never touched), frames on another origin (reported with a link to open the form in its own tab), Yes/No button questions (listed for the user)                                                                                                                                                 | `scan.test.ts`, `platforms.test.ts`                                      |
| Multi-step forms: "Step N of M", progress bars and step lists; Next/Continue/Submit buttons listed and never clicked; each step scanned fresh after the user moves on                                                                                                                                                                                                                                                             | `scan.test.ts`, `platforms.test.ts`, e2e (Workday-style, 2 steps)        |
| Repeated sections: each work experience or education block maps to the matching profile entry; a block the profile does not have is reported as missing                                                                                                                                                                                                                                                                           | `scan.test.ts`, `propose.test.ts`, e2e                                   |
| Deterministic classification first: sensitive and personal questions, then `autocomplete`, then label and field-name rules with section context; AI only for fields the rules leave unknown                                                                                                                                                                                                                                       | `scan.test.ts`, `ai.test.ts`                                             |
| Sensitive questions locked: work authorization, sponsorship, demographics, veteran and disability status, pronouns, consent and attestation boxes, pay, availability and referral source are never proposed, never fillable, and never sent to AI                                                                                                                                                                                 | `propose.test.ts`, `review.test.ts`, `test/autofill.test.tsx`, e2e       |
| Proposals from the profile only, each with its source and confidence: names, contact, location (split into city, state, country, postal), links, current job, experience, education, skills, certifications, summary, resume file, resume text, saved AI Tailor cover letter; option matching with synonyms (US states, countries, months, degree levels, yes/no) that picks nothing when unsure; dates formatted for the control | `propose.test.ts`                                                        |
| Review: groups (ready, check these, open questions, missing, you answer, not recognised), per-field edit, approve or deselect, copy, resume choice; only exact profile matches start selected                                                                                                                                                                                                                                     | `test/autofill.test.tsx`, `review.test.ts`                               |
| Fill: React-safe value setting (prototype setter, input/change/blur), dropdowns opened and options clicked, typeaheads typed without leaving the box, radios and checkboxes clicked, resume attached via `DataTransfer`; each result reported as filled, skipped, failed or not supported; labels re-checked so a changed page is not filled                                                                                      | `fill.test.ts`, `react.test.tsx` (real React), e2e                       |
| No submission: clicks only options, radios and checkboxes, refuses anything submit-like, blocks the page's own submit attempts while filling, refuses a tab that moved to another page; e2e pages count submissions and step changes and stay at 0                                                                                                                                                                                | `fill.test.ts`, `router.test.ts`, e2e                                    |
| AI help, both optional and behind consent and a click: **Match fields with AI** sends only labels of unrecognised fields (no profile data) and accepts only known profile kinds (never sensitive); **Draft answers with AI Tailor** sends open questions through the Phase 3 screening flow. Every AI result is shown for review, not pre-selected                                                                                | `ai.test.ts`, `ai-core.test.ts`, `app.test.ts`, `test/autofill.test.tsx` |
| Local API: new `POST /v1/map-fields` (no job needed; sensitive labels dropped server-side; mock provider answers offline). Existing endpoints unchanged                                                                                                                                                                                                                                                                           | `app.test.ts`                                                            |
| Messages: `autofill/scan` and `autofill/fill` validated by Zod at the side panel, service worker and content script; the scan from the page is validated like any untrusted input                                                                                                                                                                                                                                                 | `router.test.ts`, `messaging.test.ts`                                    |

Sample forms (`tests/fixtures/applications/`): generic employer form, Greenhouse-style
(react-select typeaheads, EEOC), Lever-style (full name, `urls[...]`, cards, hCaptcha),
Workday-style (4 steps, listbox buttons in a portal, conditional question, two experience
blocks, typeahead), Ashby-style (no `<form>`, Yes/No buttons), SmartRecruiters-style (web
components with shadow roots), Indeed Apply-style (4 steps, read-only email). They are written
for tests, not copied from live pages.

**Verified live (2026-10-22):** Muhaid ran the v0.3.4 Indeed checklist in Chrome (search results
page, homepage feed, switching jobs, paste fallback, other sites) and reported that it passed.

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

## Test results (2026-10-26, v0.9.0, local container, Node 22.22, Chromium 141)

v0.9.0: `pnpm verify` (typecheck, lint, format check, tests, build, bundle check) passes with
**650 tests** (extension 204, up from 195; autofill 75, up from 60). `pnpm test:e2e`:
**25 passed**, screenshot test skipped. New tests, on a new sample form with conditional
questions (`tests/fixtures/applications/conditional-application.html`):

- Autofill package: toggle and `role=radio` Yes/No buttons read as questions with their
  answers; sensitive ones locked; Yes proposed only when the profile proves it; the chosen
  button clicked and shown as already filled afterwards; an ARIA listbox revealed by an answer
  filled from the profile; tampered, reworded, salary and demographic-answer instructions
  refused by the fill step; toolbars, tabs, unlabeled and submit buttons ignored; revealed and
  removed questions counted without filling them, including one that loads later; refs kept on
  re-scan and new ones numbered after them; cloned refs never reused.
- Router: re-scan keeps refs; the status check never injects and reports a moved tab or an
  unreachable page as quiet.
- Review list: edits, ticks and unticks kept on re-scan; new fields unticked even with an exact
  profile value; a reworded question is new; values already on the page not sent again.
- Side panel: fill, automatic re-scan with "3 new questions found", new rows unticked, a
  second fill of only the newly ticked fields; the later-loading question found by the
  periodic check and scanned on request.
- Chromium: the same flow on the sample page, then sensitive questions untouched and no Next,
  Submit or form submit event. All earlier browser tests still pass.

**Manual test by Muhaid (2026-10-28, Chrome, v0.9.0):** passed and approved on
`conditional-application.html` (checklist section 13): revealed fields detected, earlier edits
and selections preserved, new questions unticked, approved Yes/No buttons and dropdowns filled,
sensitive questions locked, and no submission or advance.

### v0.8.0 (2026-10-26)

v0.8.0: `pnpm verify` (typecheck, lint, format check, tests, build, bundle check) passes with
**626 tests** (extension 195, up from 181). `pnpm test:e2e`: **24 passed**, screenshot test
skipped. New tests:

- Repository: edits stored per part beside the generated text, only on the matching draft;
  two parts saved at once; the edited version kept when generating again, restored, and
  swapped back; malformed or oversized edits dropped while the draft is kept; edits in backups.
- Side panel: autosave with "Saving…" and "All changes saved"; edits shown again after
  reopening; an edit typed just before closing is stored; a change left in the page's copy is
  recovered; revert only after confirming; generating over edits asks and the edited version
  can be restored; discard asks; screening answers saved separately; the tailored resume is
  editable and stored for its job only.
- Chromium (on-disk profile, mock API): edit a cover letter, reload the panel, type and close
  the panel at once, restart Chrome; the edited letter is back each time. Then generate again,
  restore the edited version, check that Autofill offers the edited letter on a form with a
  cover-letter field, revert to the generated text, and reload.

**Manual test by Muhaid (2026-10-26, Chrome, v0.8.0):** passed and approved for cover letter
autosave: connection to the local API in mock mode, automatic saving of cover letter edits,
the "All changes saved" indicator, and the edited letter kept after closing and reopening the
extension.

### v0.7.0 (2026-10-25)

v0.7.0: `pnpm verify` (typecheck, lint, format check, tests, build, bundle check) passes with
**612 tests** (extension 181, up from 149). `pnpm test:e2e`: **23 passed**, screenshot test
skipped. New Chromium tests:

- Export from a populated Chrome profile, import into the same profile (nothing would change)
  and into a new, empty profile; then Chrome is closed and started again on that profile and
  the profile, tracked job and the original resume file (byte-for-byte) are still there.
- Delete all local data from the options page while two side panels are open: the cached
  analysis is gone from session storage, both panels drop it after a tab switch, and a newly
  opened panel shows nothing cached.
- The midnight alarm is set for 00:00:05 local time and the safety alarm runs every 6 hours.

The midnight tests also pass in the UTC, America/Toronto, Europe/Berlin and Asia/Kolkata time
zones.

**Manual test by Muhaid (2026-10-26, Chrome, v0.7.0):** passed for importing a backup into a
separate, empty Chrome profile (checklist section 11 C): the import completed and reported the
restored items, the professional profile appeared in the Profile tab, and the restored resume
downloaded and opened correctly.

### v0.6.1

v0.6.1: `pnpm verify` passes with **580 tests** (extension 149); `pnpm test:e2e` **20 passed**,
screenshot test skipped. These are automated results only. Results recorded for v0.6.0 follow.

### v0.6.0 (2026-10-22)

- `pnpm verify` steps (typecheck including `infra` and `packages/sync`, lint, format check,
  tests, build, bundle check): pass
- `pnpm test`: **579 passed** (extension 148, job-extraction 110, api 74, autofill 60, ai-core
  47, resume-parser 44, matching 30, sync 20, shared 18, tracking 15, infra 13)
- `pnpm test:coverage`: 86.8% statements, 77.9% branches, 84.9% functions, 88.7% lines
- `pnpm test:e2e`: **20 passed**, screenshot test skipped by default. New in v0.6.0: two
  Chromium browsers with the extension create an account and sign in through the real
  `chrome.identity` flow against `pnpm cloud:local`, sync records both ways, then one deletes
  the cloud data and the other pauses without uploading. All Phase 1 to 5 tests still pass.
- `cdk synth`: succeeds with default and all-options settings; cdk-nag reports no unacknowledged
  findings. The bundled Lambda handlers load and answer in plain Node.

## Not yet verified

- **v0.9.0 on live application sites.** Approved on the practice form only; real forms with
  conditional questions and Yes/No buttons have not been tried.
- **The rest of v0.8.0 in Chrome.** Muhaid tested cover letter autosave and reopening the
  extension. Not reported yet: tailored resume and screening answer edits, closing straight
  after typing, a Chrome restart, drafts kept per job, Revert, Generate again with Restore,
  Discard confirmation, Autofill using the edited letter, and edits in Export and Import
  (section 12 B2 to F).
- **The rest of v0.7.0 in Chrome.** Muhaid confirmed importing into a separate profile (profile
  and resume file restored). Not reported yet: whether tracked applications and AI drafts came
  across, a restart of the new profile, Merge on the populated profile, Replace and Undo,
  damaged files, Delete all clearing cached analyses, and the badge changing at midnight
  (sections 11 B and D to G). The badge at a real midnight has only been checked by its
  scheduled time.
- **Phase 6 in Chrome.** Muhaid skipped the manual checklist (`docs/INSTALL-CHROME.md`,
  section 10) on 2026-10-25. Sign-in, sync, conflicts and cloud data controls have only been
  checked by automated tests, including the two-browser Playwright test.
- **Phase 6 on real AWS.** Not deployed (needs approval). Real DynamoDB, Cognito's hosted page,
  API Gateway's authorizer and IAM have only been checked through synthesized templates,
  cdk-nag and local stand-ins.
- **Phase 4 on live application sites.** No platform is marked verified; only the practice form
  was tested live (passed). Real Workday, Greenhouse, Lever,
  Ashby, SmartRecruiters and Indeed Apply markup may differ from the samples.
- **A real Claude request.** No paid call has been made. The request shape is verified against
  the real SDK and a fake API, but output quality, latency and actual cost per draft need
  Muhaid's own key and approval.
- Chrome's prompt for the optional Indeed access, by hand, unless it appeared during Muhaid's
  checklist run (automation cannot click it; the e2e build has the access granted up front).
- Running the local API on Windows or macOS (tested on Linux).

- Real-world resumes. The parser is tested on a generated PDF and DOCX and on varied text
  layouts. Two-column PDFs, tables and image-only (scanned) PDFs are known weak spots (see below).
- The real side panel container (e2e opens `sidepanel.html` as a tab).
- The GitHub Actions workflow (no repository yet).

## Under development

Nothing yet. Next focus chosen by Muhaid: two-column PDF resume parsing and preparing the
project for a GitHub portfolio; the first step waits for his go-ahead. Phase 6 manual testing is deferred by Muhaid.

## Known bugs and limitations

- **Import data (new in v0.7.0):**
  - Merge never edits an existing record, so a newer copy of a tracked application in the file
    is not used when this browser has the same record; Replace uses the file's copy.
  - Merge treats two records for the same job (same job key, address, or company and title) as
    one and keeps the one here.
  - Exports from 0.6.1 and earlier have no resume files, so those resumes cannot be restored.
  - The undo copy is kept until the next import or Delete all, and is the size of your data
    (including resume files).
  - Replace downloads the pre-import backup through Chrome's normal download, which may ask
    where to save it.

- **Cloud sync (new in v0.6.0):**
  - Not deployed; only the local test server works until an approved AWS deployment.
  - An access token stays valid up to 1 hour after sign-out or account deletion.
  - Resume files, AI drafts and settings are not synced.
  - The same job saved separately on two devices before their first sync stays as two records.
  - The extension still uses the local AI server for drafts; the cloud AI route exists but is
    not wired into the extension, and API Gateway's 29-second limit can cut off long drafts.
  - An unpacked extension's id depends on its folder; Cognito's callback must match it, so
    moving the folder needs a redeploy with the new id.
  - Local tests use dynalite in place of DynamoDB.

- **Tracker (new in v0.5.0):**
  - Stored in this browser profile; optional cloud sync arrived in v0.6.0. Export CSV or
    Export data for a copy.
  - Reminders are a toolbar badge and a list in the tab, not system notifications (that would
    need the `notifications` permission). Since v0.7.0 the badge refreshes just after local
    midnight; if the computer is asleep then, it refreshes when Chrome wakes it.
  - "Applied" is set only by the user; ApplyPilot cannot see whether a site accepted a
    submission. A record created after autofill has the form's title and no company unless the
    job was analyzed on the same site first.
  - Analytics are counts over the user's own records, not benchmarks, and are only as complete
    as the statuses kept up to date.

- **Autofill (v0.4.0):**
  - No platform is verified live yet; all are experimental.
  - A form inside a frame from another site (an embedded Greenhouse board, for example) cannot
    be read; the tab offers a link to open the form on its own.
  - Questions drawn as Yes/No buttons (Ashby) are listed but not filled.
  - Closed shadow roots, canvas-drawn controls, rich-text editors and drag-and-drop-only
    uploads are not supported; use Copy and paste.
  - A page script can still submit with `form.submit()` (which fires no event), and nothing
    stops a page from doing so on its own. ApplyPilot itself never clicks a submit control.
  - Dates without a day use the 1st and are marked for review. Years of experience, start
    date, salary and similar facts are not stored, so those fields stay empty.
  - Workday and similar sites need an account; sign in yourself. ApplyPilot never handles
    passwords.
  - After a fill reveals new questions, scan again to see them.

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
- **Draft edits (v0.8.0):** edits are kept for the latest draft of each kind per job, up to 30
  drafts in all, as before; the oldest are dropped first. Only one replaced edited version is
  kept per draft. If the same draft is open in two side panels at once (two windows), the last
  save wins. The tailored resume's review cards show the generated text; edits are in the text
  box below them.
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

1. **Smarter Application Autofill (v0.9.0, in progress):** detect questions revealed after a
   fill, a re-scan that keeps approved answers, Yes/No radio and custom select support, with
   sensitive questions still locked. Then Muhaid tests it. Phase 6 manual testing is deferred;
   run section 10 of INSTALL-CHROME.md whenever you want to verify cloud sync.
2. **Decision for Muhaid:** whether to deploy ApplyPilot Cloud to your own AWS account
   (estimated USD 0.00 to 0.15 per month at personal use; see docs/AWS.md). Not done without
   your explicit approval.
3. **Optional:** a real application on Greenhouse or Lever, and real Claude drafts with your own
   key, as before. Neither is done without your approval.
4. **Phase 7** (after Phase 6 approval): accessibility audit, performance, Chrome Web Store
   preparation.
