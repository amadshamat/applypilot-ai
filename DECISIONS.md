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
