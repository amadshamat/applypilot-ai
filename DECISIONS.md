# Decisions

Significant choices, why they were made, and what would change them.

## 001: pnpm workspaces with source-consumed internal packages

pnpm is fast, strict about undeclared dependencies, and has first-class workspaces. Internal
packages export TypeScript source and are bundled by Vite, so there is no per-package build and
no risk of a stale `dist`. Revisit if a package must be published or consumed by a non-Vite
build (for example Lambda bundling with esbuild, which also handles TS source).

## 002: Job extraction is its own package with no Chrome dependency

Extraction takes a `Document` and a URL and returns plain data. That makes it testable against
fixture pages in jsdom, keeps site-specific adapters separate from general logic, and lets the
same code run server-side later.

## 003: Custom Vite build instead of an extension framework plugin

The extension is built with two plain Vite configs: one for the HTML pages and the module
service worker, one for the content script as a single IIFE (injected scripts cannot import
chunks). The manifest is generated from a typed TypeScript function. This avoids a dependency on
a third-party plugin's support for Vite 8 and keeps the build easy to explain. Trade-off: no HMR
for extension pages; `pnpm dev` rebuilds on change instead.

## 004: activeTab on toolbar click, no host permissions

Reading the current page needs either broad host permissions (an install-time warning about
reading all sites) or `activeTab`. ApplyPilot handles `chrome.action.onClicked` itself and opens
the side panel from it, so the click both opens the UI and grants `activeTab` for that tab.
`openPanelOnActionClick` is set to false because it is not documented to grant `activeTab`.
Cost: users must click the icon again after switching tabs; the UI explains this when it
happens. Optional per-site host permissions can be added later for frequently used job boards.

## 005: On-demand content script injection

The content script is injected with `chrome.scripting.executeScript` only when the user asks for
an analysis. Nothing runs on pages the user did not choose, and no `content_scripts` entry means
no host permission is needed.

## 006: Zod schemas as the single contract

Job postings, settings and messages are Zod schemas in `@applypilot/shared`; TypeScript types are
inferred from them. Every boundary (storage reads, messages in both directions, extraction
output) validates at runtime. Each extracted field is a discriminated union of `found` (value,
source, confidence) or `missing`, which makes "unknown" impossible to confuse with a value.

## 007: Strategy precedence and validation in extraction

JSON-LD beats site adapters, which beat description analysis, which beats generic page signals.
For each field the first schema-valid value wins; invalid values are discarded with a warning.
Ambiguity is preserved rather than resolved by guessing: `$` alone does not imply USD, and
conflicting work-arrangement wording returns nothing. Ambiguous English words ("Go", "REST",
"Swift") are matched only in technical capitalization.

## 008: Browser APIs behind injected services

React components get Chrome access through an `AppServices` context, and the service worker's
logic is a pure function taking a `BackgroundDeps` object. Tests swap in in-memory storage and
fake messaging, so most behavior is tested without a browser; Playwright covers the real wiring.

## 009: shadcn/ui conventions without Radix

UI primitives follow shadcn/ui conventions (Tailwind classes, `cn` with tailwind-merge, variant
maps) but are written locally on native elements. Phase 1 needs only simple components, and this
avoids several Radix packages. Radix-based shadcn components (dialog, select, popover) can be
added when a component needs complex accessibility behavior.

## 010: TypeScript 6.0 rather than 7.0

TypeScript 7.0 (the native port) is the newest release, but typescript-eslint supports only
`<6.1`. Type-aware linting matters more than compiler speed at this size. Revisit when
typescript-eslint supports 7.

## 011: jsdom 29 rather than 30

jsdom 30 requires Node 22.22.2 or newer; the development environment has 22.22.0. jsdom 29
supports Node 22.13+, keeping the documented minimum lower.

## 012: Honest placeholders for unbuilt sections

Autofill, Resume, Applications and AI Copilot tabs exist so navigation is final, but each says
"Not built yet" with its phase. The Analyze view shows no match score rather than a fabricated
one.

## 013: Defer `packages/ui`, `apps/dashboard`, `services/api`

These folders from the original plan will be created with their first real code. Empty
scaffolding would imply progress that does not exist.

## 014: Adapters can outrank structured data

Normally JSON-LD wins over a site adapter. On a search results page, though, structured data
(if any) may describe the site or another job, while the adapter reads exactly the job the user
selected. Adapters for such pages set `preferOverStructuredData`; Indeed is the first.

## 015: Employment type is a list

Postings often offer several types ("Part-time, Full-time"), and JSON-LD allows an array.
Keeping only one would silently drop what the employer stated.

## 016: Indeed pay currency comes from the country site

Indeed shows a bare "$" but localizes pay per country site (www → USD, ca → CAD). The adapter
uses the subdomain to set the currency only when the text itself has no currency code or
unambiguous symbol. Elsewhere a bare "$" still leaves the currency unknown.

## 017: Re-injected content script replaces its listener

Each analysis injects the content script again. The new copy removes the previous listener
before adding its own, so a tab keeps working after the extension is updated and never answers
twice.

## 018: Resumes are parsed on the device, deterministically

PDF text comes from pdf.js and DOCX from mammoth, both inside the extension; a rule-based parser
turns the text into a draft. Nothing leaves the browser, the result is the same every time, and
every value can be traced to a line in the resume (a test checks that the parser never produces
text that is not in the source). An AI fallback for hard layouts belongs to Phase 3 and will be
opt-in.

## 019: pdf.js legacy build, worker shipped as a file, WASM off

The legacy build supports Chrome 116 (the manifest minimum). The worker is copied to the
extension root and loaded by `chrome.runtime.getURL`, which the `script-src 'self'` policy
allows; blob or remote workers would need a weaker CSP. WASM image decoders are disabled because
they would need `'wasm-unsafe-eval'`, and resumes only need text.

## 020: A parsed resume is a draft until the user saves it

Uploading stores the file and its parsed draft as a resume version but never touches the
profile. The review screen offers "Add what's new" (de-duplicated merge that never overwrites a
field the user filled in) or "Replace my profile" (keeps job preferences).

## 021: Profile in chrome.storage.local, resume files in IndexedDB

The profile is small structured data that every extension page reads and subscribes to, which
chrome.storage does well. Original files are binary and up to 5 MB each, so they go to
IndexedDB, stored as ArrayBuffers (clonable everywhere, including the test fake).

## 022: Unknown parts of a match are excluded, not scored as zero

If a posting states no years of experience, that 25% of the weight is removed from both sides of
the average and the card reports the coverage. Scoring it as 0 would punish the user for the
posting's silence; scoring it as 100 would flatter them. A score is shown only when something
could be compared.

## 023: Skill credit follows evidence, with half credit for related skills

A skill counts only when a profile entry shows it, and the card names the entry. A more
specific skill satisfies a general one (AWS Lambda is AWS); a sibling earns half credit and is
labelled "related", never "matched". Requirement lines with "one of" or an "or" after the first
skill are treated as alternatives.

## 024: Suggestions only point at facts the profile already holds

Suggestions may tell the user to surface, reorder or explain what they already have, and to add
real numbers if they know them. Missing skills are shown as "Not in your profile" with "add these
only if you genuinely have them". No suggestion proposes a skill, number or wording the user has
not stated.

## 025: Year-only dates are read conservatively

"2022 – 2023" could mean two months or two years. Counting from December to January means the
experience total can be too low but never too high, and the editor encourages month precision.

## 026: Claude is called from a local API, not from the extension

Anything shipped in an extension can be read by anyone who installs it, so a Claude API key in
the bundle would be a leaked key. Phase 3 adds `services/api`, a small Node service on
127.0.0.1 that holds the key in a git-ignored `.env`. The extension holds only a random access
token for it. The AWS backend is Phase 6 and needs approval; a local service gives the same
security property now at no cost, and its handler is written to move into Lambda unchanged.

## 027: Free mock mode by default; paid calls need two explicit settings

`APPLYPILOT_PROVIDER` defaults to `mock`, and `anthropic` is refused unless a key is also set.
Setting only a key does nothing. The mock provider drafts by reordering and quoting the user's
own text, so it can never invent anything, and it lets the whole flow (and e2e tests) run
offline. Every draft records which provider produced it, and the UI labels mock drafts.

## 028: Claude Opus 5.5 with structured outputs, adaptive thinking, medium effort and fallbacks

Default model `claude-opus-5-5`. Output is constrained to each task's schema with
`output_config.format` and parsed by the SDK, which removes free-text parsing. Thinking is
adaptive (the only mode this model supports) with `effort: medium` as a cost/quality balance,
configurable with `APPLYPILOT_EFFORT`. Server-side `fallbacks: "default"` (beta
`server-side-fallback-2026-07-01`) retries a classifier-declined request on Anthropic's
recommended fallback model inside the same call; the response's `model` is recorded so the user
can see which model answered, and cost is shown only for models with a known price.
`stop_reason` is checked for `refusal` and `max_tokens` before any output is read.

## 029: The extension re-checks every draft against the profile (grounding)

The prompt asks for truthfulness; code verifies it. Rewritten bullets must cite the original
bullets they come from, or they are removed. Unknown entries and skills outside the user's list
are removed. Numbers and known skills that the source does not contain are flagged on the exact
bullet or paragraph. The check runs in the extension against the profile stored there, so it
does not depend on trusting the server, and it runs again whenever a saved draft is shown.

## 030: Only the data each task needs is sent, with short refs instead of ids

Contact details, links, GPA, preferences and salary are never sent; the name is included only
for cover letters. Profile entries are labelled `E1`, `P2` and so on: short refs are easier for
the model to cite correctly than UUIDs, and storage ids stay in the browser. The user can see
the exact JSON before sending.

## 031: Sensitive screening questions never reach the model

A local classifier marks questions about work authorization, criminal history, age,
demographics and legal attestations as sensitive, and pay, availability, relocation, references
and contact details as personal. Both are left to the user and are not sent. The API applies the
same rules again and answers without calling Claude if nothing is left. The classifier errs
toward "you answer"; a false positive costs the user a minute, a false negative could misstate
their legal status.

## 032: The local API is hardened like a public one

A localhost port is reachable from any web page the user visits. The server binds to 127.0.0.1,
rejects Host headers other than localhost (DNS rebinding), allows only `chrome-extension://`
origins, requires a bearer token compared in constant time, caps bodies at 300 KB and limits
generation requests per day. Host access to 127.0.0.1 is an optional extension permission,
requested only from the Connect click.

## 033: Drafts are saved per job and task, with the request that produced them

Closing the side panel should not lose a draft or cost another request. The latest draft of each
task for each job (keyed by page URL without fragment, at most 30) is stored in
`chrome.storage.local` together with its request, so it can be re-validated and re-reviewed when
shown. Edits in the text boxes are not saved; users copy or download the final text.

## 034: Prompts are versioned and kept free of per-request content

Each task has one system prompt with a version string stored on every draft, so a change in
output can be traced to a prompt change. Request data goes only in the user message (profile as
JSON, posting fenced as untrusted), which keeps the system prompt identical across requests, so
prompt caching can be turned on later without restructuring.

## 035: On pages that list many jobs, nothing is read outside the selected job

An Indeed search page shows a list of jobs plus one selected job's details. When the details
panel was not found, the extractor used to fall back to reading the whole page, which mixed the
page title and other results into one "job" (reported 2026-10-15). Adapters for such pages now
provide `locate()`, which returns the selected job's container, possibly inside a same-origin
frame. Every strategy (adapter, description analysis, generic DOM) then reads only inside it, and
page-wide signals (document title, meta tags, search-page JSON-LD) are skipped. If no container
is found, or it still shows another job than the one selected, the result has no job fields and
says why. Where Indeed's hooks are absent (the homepage feed, v0.3.2), the panel is found from
the selected job's own card: its id, then a heading outside the list with the card's title. An
empty result the user can retry is better than a confident mix of two jobs, because
AI drafts and match scores are built on it.

## 036: An analysis is tied to the job the tab shows

Indeed switches jobs by changing the address in place, without a page load, so per-tab caching
and an open side panel could keep showing the previous job. Each analysis is compared with the
tab's current address by job identity (the Indeed job id where present, otherwise the address
without its hash). A mismatch drops the cached result, warns in the Analyze view, and stops the
AI Tailor from drafting until the user analyzes again. AI drafts use the same identity as their
key.

## 037: Read the job inside Indeed's details frame, ask for Indeed access only from a click, and let the user paste

Reported 2026-10-20: on an Indeed search page with a job open on the right, the analysis said
"No job is open". When Indeed shows the details in a frame on another origin (for example a
different Indeed subdomain), the page cannot read that frame (`contentDocument` is null), and
the toolbar click (activeTab) grants access to the tab's own origin only. Three changes:

1. The content script is injected into every frame Chrome allows. When the page finds no job,
   the background asks each frame what it shows and reads only a frame whose job id equals the
   selected job's id (with no selection known, only the single frame showing a job). The frame's
   result is checked again for the same id. A frame can never stand in for a different job.
2. When a frame is still unreadable, the result names its origin, the warning says so instead of
   "No job is open", and the side panel offers **Allow reading Indeed job details**. That
   requests the optional permission `https://*.indeed.com/*` from the user's click, never
   automatically, and the analysis runs again. Declining keeps everything working as before.
3. **Paste the job instead** always works: the user copies the posting's text, enters the title,
   and only that text is analyzed (fields marked "You entered").

When no job is found, the bug-report copy now includes a content-free outline of the page (tags,
ids, test hooks, frame origins and paths, whether each frame is readable, shadow roots; digits in
names masked; no text). The live markup could not be inspected from the build environment, so
this outline is how the real structure gets confirmed.

Rejected: a declared content script or permanent `host_permissions` for Indeed (reads every
Indeed page without a click and adds an install warning), and reading the frame by fetching its
address from the background (a second request with the user's cookies, and not what the user sees).

## 038: Autofill is deterministic first, and sensitive questions are locked

Phase 4 classifies each form field with rules, in a fixed order: sensitive and personal
questions first (work authorization, sponsorship, demographics, veteran and disability status,
pronouns, consent and attestation boxes, pay, availability, referral source), then the
`autocomplete` attribute, then label and field-name rules with the section as context. A field
the rules recognise as sensitive is locked: it gets no proposed value, no checkbox, and cannot be
filled or sent to AI, even if the user types a value. The user answers it on the page. Only exact
profile matches start selected; everything else waits for the user. Option lists (states,
countries, months, degree levels, yes/no) are matched with synonyms and pick nothing when the
match is unclear.

Rejected: letting a model classify every field (slower, costs money, and a mistake can route a
profile value into a legal question), and a "remember my answer" store for sensitive questions
(the user asked that these stay under their manual control).

## 039: Autofill never advances or submits an application

The filler clicks only options, radios, checkboxes and the triggers that open a dropdown. It
refuses any control that looks submit-like (a submit or image input, a submit button inside a
form, or text starting with Submit, Apply, Send, Next, Continue, Review, Finish, Proceed or
Complete). While it fills, it blocks the page's own `submit` events and untrusted
clicks on submit-like controls, then removes those guards. Multi-step forms are handled as one
scan per step: the user moves on with the page's own button and scans again. Before filling, the
service worker checks that the tab still shows the scanned page (origin and path), so a stale
review cannot fill a different page. CAPTCHAs are reported and never touched; frames on another
origin are reported with a link to open them in their own tab rather than read through another
route.

## 040: AI field matching sends labels only

**Match fields with AI** sends the labels, hints, section names, control types and option texts
of fields the rules left unknown (40 at most), and nothing from the profile. The model answers
with a profile kind from a fixed list that contains no sensitive kinds, or "none". The extension
drops sensitive labels before sending, the API drops them again, results are kept only for
fields that were sent and kinds that exist, confidence is capped at medium, and every AI-mapped
field is shown under "Check these" without being selected. The value always comes from the
profile, never from the model. Open questions go through the Phase 3 screening flow instead,
which already filters sensitive questions and grounds answers in the profile.

## 041: Platforms are experimental until a live application is filled

Indeed Apply, Greenhouse, Lever, Workday, Ashby and SmartRecruiters are recognised by address
and labelled **Experimental** in the Autofill tab. Their sample forms in
`tests/fixtures/applications/` were written for this project from public knowledge of each
platform's markup, not copied from live pages, so passing them is not proof that a live form
works. A platform moves to **Verified** only after Muhaid fills a real application on it in
Chrome and the result is recorded in PROGRESS.md. All platforms use the same generic engine;
recognising one only changes the label and a few hints.

## 042: Check elements by tag name, not `instanceof`

The scanner reads same-origin frames and shadow roots. Each frame has its own `HTMLInputElement`
constructor, so `instanceof` checks fail for elements from another frame (and in jsdom, which
was how this showed up: every field was classified as a listbox button). Guards compare
`tagName` instead, and values are set through the element's own prototype setter with
`Reflect.set`, which React-controlled inputs need to notice the change.

## 043: The fill step re-checks every instruction against the live page

Found in the Phase 4 acceptance review. The side panel already refuses sensitive fields, but the
content script filled whatever element carried the instruction's ref attribute, and the page,
which is untrusted, can change those attributes or labels after the scan. Before each field,
the fill step now skips sensitive questions (classified from the instruction's label and from
the field's current label), password and hidden inputs, and text fields that are no longer
visible. The check repeats rules the side panel applies, on purpose: the panel is the main
gate, the page-side check is the backstop.

## 044: The tracker lives in local storage as one validated list

Applications are stored under `applypilot.applications` in `chrome.storage.local` as one array
(1,000 at most), validated record by record. A record that does not parse (for example one a
newer version wrote) is kept as it is and written back on every save, rather than dropped.
`chrome.storage.local` was chosen over IndexedDB because the records are small, the existing
export and delete controls already cover it, and storage change events keep every open panel
and the service worker in sync. All tracking logic (status changes, duplicates, filters,
reminders, analytics, CSV) is a pure package, `@applypilot/tracking`, tested without a browser.

Rejected: a database per record (more code, no benefit at this size) and any server copy before
Phase 6 is approved.

## 045: Only the user marks an application as applied

ApplyPilot never submits a form and cannot tell whether a site accepted one, so the tracker
never moves a record to Applied by itself. After a fill, the Autofill tab asks "Did you submit
it?" and offers a button. The analyzed job is used for the record only when it was read on the
same site as the form; otherwise the record gets the form's title and address and no company,
rather than borrowing details from an unrelated analysis.

## 046: Reminders are a badge, not notifications; CSV cells cannot run formulas

Follow-up reminders show as a count on the toolbar icon and a list in the tab. The badge is
refreshed when the tracker changes, at browser start and hourly through `chrome.alarms`, which
adds no install warning. System notifications would need the `notifications` permission and
would show job details outside the browser window; they can be added later if wanted.

Job titles, companies and notes can come from web pages, and a CSV opened in a spreadsheet will
run a cell starting with `=`, `+`, `-` or `@` as a formula (CSV injection). Such string cells
are prefixed with an apostrophe in the export. Numbers (match scores) are written as numbers.

## 047: Cloud sync is opt-in, local-first, and never overwrites without a safeguard

The browser stays the primary copy. Sync is off until the user connects, signs in and turns it
on, and the extension works fully without it. The sync engine (`packages/sync`) compares three
copies of each item: the one from the last sync (the "shadow"), this browser's, and the cloud's.
Only changes are moved; changes on both sides are merged field by field (notes and status
history are combined), and a real clash, including an edit against a deletion, is parked as a
conflict until the user picks a side. Before sync changes or deletes anything that already
existed in the browser, a backup is kept (the last two, restorable from Settings). A run that
would delete more than five records in either direction stops and asks. A local write is
refused if the user edited data while the run was in progress (compare-and-set), and retried.

Rejected: last-writer-wins by timestamp (silently loses edits made on a second device, and
clocks differ) and making the cloud the primary copy (breaks the offline, local-first design
users already have).

## 048: Versioned writes and a data epoch, not locks

Every cloud item has a version. A push names the version it was based on, and DynamoDB writes
it only if that is still the current version (a conditional put), so two devices can never
overwrite each other; the loser re-reads and merges. Deletions are tombstones so other devices
learn about them. Deleting cloud data starts a new "epoch"; a device still on the old epoch
cannot upload until the user decides, so deleting cloud data from one device is not undone by
another device re-uploading everything a minute later.

## 049: Single-table DynamoDB keyed by the token's user id

One table, partition key `USER#<sub>` where `sub` comes only from the verified Cognito access
token, sort keys `PROFILE`, `APP#<id>`, `META` and rate-limit counters. A request has no way to
name another user's partition. A sparse local secondary index on `changedAt` serves the change
feed. Items are gzip-compressed (300 KB stored limit). On-demand capacity: personal-scale
traffic costs cents and needs no capacity planning.

Rejected: one table per entity (more IAM and more requests for the same data) and Aurora or RDS
(an always-on database costs money every hour for a handful of users).

## 050: Cognito hosted sign-in with PKCE through chrome.identity

The extension never sees passwords. It opens Cognito's hosted page with
`chrome.identity.launchWebAuthFlow`, uses the authorization code flow with PKCE (extensions
cannot keep a client secret), checks the `state` value and the ID token's audience, and keeps
tokens only in `chrome.storage.session` (memory, not disk, not readable by content scripts).
The API checks the token twice: API Gateway's Cognito authorizer, then `aws-jwt-verify` in the
Lambda (`token_use=access`, client id, issuer, signature). The Lite plan is free up to 10,000
monthly active users.

Rejected: a sign-in form inside the extension (handles passwords, needs the less safe password
flow) and Google sign-in through `chrome.identity.getAuthToken` (works only in Chrome with a
Google account, and ties the app to Google).

## 051: Serverless on API Gateway REST and Lambda, built from the existing API code

The cloud API reuses the request/response shape of the Phase 3 local API, so the same code runs
in tests, on the local test server and in Lambda (thin adapters for each). REST API rather than
HTTP API because REST supports per-stage throttling, Cognito authorizers with scopes, request
size limits and WAF directly. Three functions (data, account, optional AI), each with its own
least-privilege role, so the data function cannot delete Cognito users and only the AI function
can read the Claude key in Secrets Manager. Node.js on arm64 (cheaper per GB-second). cdk-nag
AWS Solutions checks run on every synth; each exception is acknowledged in code with a reason.

## 052: Everything is testable without AWS; deployment needs approval

`pnpm cloud:local` runs the real cloud API code with dynalite (an in-memory DynamoDB) and a
small Cognito-like OAuth server (PKCE, hashed passwords, JWKS, RS256 tokens shaped like
Cognito's). Unit, integration and e2e tests use them, so Phase 6 was built and tested without
an AWS account or any charges. The extension needs two new permissions, `identity` (the sign-in
window) and `unlimitedStorage` (sync keeps a last-synced copy and two backups, which can pass
Chrome's 10 MB default for 1,000 records); neither shows an install warning. Host access to
`*.amazonaws.com` and `*.amazoncognito.com` is optional and requested only for the exact hosts
of the deployment the user connects to.

## 053: Import is data-only, previewed, and Merge never changes existing data

Export data writes a versioned file (`format: applypilot-backup`, version 2) that now includes
the original resume files as base64; files from 0.1 to 0.6.1 (no format marker) are read as
version 1. An imported file is parsed with JSON.parse and every part is checked against the
schemas the extension already uses for its own storage, record by record, so one bad record
does not block the rest and unknown fields never reach storage. Resume files must match their
recorded size and start like a PDF or a Word (ZIP) file. Device-specific items (the API access
token, cloud sync settings and bookkeeping) are never imported: they belong to the browser that
made the file, and importing sync state could make the next sync overwrite cloud data.

Nothing is written until the user has seen a preview and confirmed. **Merge** is the default
because it cannot lose data: it only adds what is missing, and treats a record with the same id
or the same job as already present. **Replace** is for restoring a known-good backup over a
broken or unwanted state; it is limited to the parts the file contains, so an old export without
resume files cannot wipe the resumes here.

## 054: Undo copy in storage plus a downloaded backup before Replace

Before any import, everything it could touch (profile, tracker, settings, AI drafts and resume
files) is copied to `applypilot.importUndo`. If a write fails part-way the copy is put back at
once; otherwise **Undo last import** restores it. Replace also downloads a regular export of the
current data first, so a copy exists outside the browser even if the extension is removed. The
undo copy is excluded from exports and is removed by Delete all local data.

## 055: A data-reset signal keeps open pages honest; the badge follows local midnight

Delete all, import and undo write `applypilot.dataReset` (`{at, reason, origin}`). Every
ApplyPilot page listens: it clears its in-memory state (the page analysis, the open tracker
entry) and, unless it made the change itself, remounts its views so they re-read storage. Delete
all also removes every `job-analysis:<tab>` entry from chrome.storage.session, from the page and
again in the service worker in case the page closed first. This fixes deleted analyses
reappearing on a tab switch or when the panel was reopened.

The follow-up badge used an hourly alarm, so a reminder could appear up to an hour after
midnight. It now uses a one-off alarm at 00:00:05 local time, computed from the local date so
daylight-saving nights are handled, and set again whenever it fires or the worker starts. A
6-hour alarm (instead of the hourly one) re-sets it in case the clock or time zone changed.
Chrome fires missed alarms when the computer wakes, so a sleeping laptop shows the badge on wake.

## 056: Draft edits are stored beside the generated draft, per part, and never written blind

Edited text is stored on the saved draft as `edits` (a map from part to text: `letter`,
`resume`, or a screening question id) instead of replacing the generated output. The generated
text is what the grounding review checked, so keeping it allows **Revert to generated text**
and keeps the review notes meaningful; the edits are the user's own words and are not
re-checked. A part whose text equals the generated text has no entry.

Saving is automatic: after 0.6 s without typing, and at once when the panel is hidden or the
box unmounts. chrome.storage writes are asynchronous and a closing page may not finish one, so
every keystroke is also written synchronously to the page's localStorage and stored on the next
mount if needed; the copy is cleared once stored and by Delete all. Each edit names the draft it
belongs to (task, job and generation time): if the draft was replaced or deleted meanwhile, the
edit is not written onto the new one. Writes to the drafts list are serialised per page so two
answers saved together are both kept.

Generating again over an edited draft asks first and keeps the edited version as `previous`
(one level), which **Restore my edited version** swaps back. Generating twice in a row without
edits keeps the same `previous`, so a second click cannot lose the user's edits.

## 057: Re-scans keep refs; new questions are marked and never pre-ticked

Conditional questions appear only after an answer, so after every fill the panel scans again
(read-only), and while a scan is shown it asks the page every 2.5 s whether visible fields
without a ref exist. That check (`content/form-changes` via `autofill/status`) never injects a
content script and only reads the DOM, so it is safe to repeat; a tab that moved on is reported
instead.

A re-scan (`keepRefs`) keeps a field's ref only when exactly the same elements still carry it,
so a block cloned with `cloneNode` (which copies the attribute) cannot inherit another field's
approved answer: both copies get new refs. New refs are numbered after the highest one in use.
The panel then matches rows by ref, control and label; a reworded question is a new question.
What the user decided is kept (typed value, tick or untick). Rows found for the first time are
marked New and start unticked even when the profile has an exact value, because the user has
not seen them; values the page already shows are not sent again. When none of the reviewed
refs is left, or the step number changed, the re-scan is a new step and the review starts
fresh. Considered and rejected: re-scanning automatically on every page change (the list would
move under the user while they review it) and filling revealed fields in the same pass (that
would fill fields nobody approved).

## 058: Yes/No buttons are a control kind, with sensitive checks on the page's answers too

Many forms draw Yes/No as two buttons (`aria-pressed` toggles, `role="radio"` outside a
radiogroup, or plain buttons). They are now the `button-group` control: 2 to 6 short, visible
buttons side by side that either expose a pressed or checked state or read as answers. Groups
in toolbars, tab lists, navigation, and buttons that open dropdowns, submit or advance are
excluded; a group without a label is reported only, since it could be a consent or eligibility
question. Filling clicks the one chosen button through the same submit-refusing click as other
controls and checks that its state changed; a group without state is reported as clicked, to
check.

The fill step's own sensitive check now also reads the group's current label and answer texts
from the page and refuses pay questions, so a group whose answers are demographic (Male /
Female) is refused whatever its label says, and a tampered or reworded instruction cannot fill
a sensitive question. Yes/No questions are answered from the profile only when it proves Yes
(a saved GitHub, LinkedIn or portfolio link, a current education entry); a missing entry proves
nothing, so No is never proposed.
