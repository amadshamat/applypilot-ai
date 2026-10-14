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
