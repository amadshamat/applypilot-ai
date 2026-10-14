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
