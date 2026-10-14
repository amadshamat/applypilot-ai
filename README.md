# ApplyPilot AI

**Apply smarter. Apply faster. Stay organized.**

ApplyPilot AI is a Chrome extension (Manifest V3) that acts as a human-in-the-loop job
application copilot. It reads the job posting you are looking at, explains what it found and
where each detail came from, and (in later phases) matches it to your verified profile, drafts
tailored materials, assists with form filling that you approve field by field, and tracks your
applications.

> **Project status: Phase 1 (Foundation) complete, with the first slice of Phase 2 (job
> extraction).** Profile, resume parsing, matching, AI features, autofill, tracking and the AWS
> backend are **not built yet**. The extension says so in its UI. See [PROGRESS.md](PROGRESS.md)
> for the exact, verified state.

![Side panel analyzing a job posting](docs/screenshots/sidepanel-analysis-light.png)

## Problem

Students and early-career applicants send many applications, each needing the same details
re-typed, a resume tuned to the role, and a way to remember where everything stands. Existing
"auto-apply" bots trade trust for volume: they guess answers, invent qualifications and submit
without review. ApplyPilot takes the opposite approach: deterministic where possible,
explainable everywhere, and nothing is submitted or claimed without the user's approval.

## Features

| Feature                                                                                                | Status               |
| ------------------------------------------------------------------------------------------------------ | -------------------- |
| MV3 extension with React side panel, six-section navigation, light/dark themes                         | Done                 |
| Settings page (theme, AI-processing consent, match weights) with validation                            | Done                 |
| Local data export and deletion                                                                         | Done                 |
| Typed, runtime-validated messaging between side panel, service worker and page                         | Done                 |
| Job extraction: JSON-LD, Greenhouse adapter, generic page analysis, per-field source and confidence    | Done                 |
| Platform detection for Lever, Workday, SmartRecruiters, Ashby (generic extraction only, flagged in UI) | Done                 |
| Resume profile, PDF/DOCX parsing, explainable match score                                              | Phase 2, not started |
| Claude-powered tailoring, cover letters, screening answers                                             | Phase 3, not started |
| Assisted autofill with per-field approval                                                              | Phase 4, not started |
| Application tracking and analytics                                                                     | Phase 5, not started |
| AWS backend (API Gateway, Lambda, DynamoDB, Cognito, CDK)                                              | Phase 6, not started |

## Technology

- **Extension:** TypeScript 6, React 19, Vite 8, Tailwind CSS 4, Zustand, React Hook Form, Zod 4,
  Lucide icons, Chrome Side Panel / Scripting / Storage APIs
- **Quality:** pnpm workspaces, ESLint (typescript-eslint strict type-checked), Prettier, Vitest,
  React Testing Library, Playwright (real Chromium with the built extension), GitHub Actions
- **Planned:** Node.js Lambdas, API Gateway, DynamoDB, Cognito, CloudWatch, AWS CDK, Anthropic Claude API (server-side only)

## Architecture

```mermaid
flowchart LR
  subgraph Browser
    SP[Side panel<br/>React] -- typed messages --> SW[Service worker<br/>message router]
    OP[Options page<br/>React] --> ST[(chrome.storage)]
    SP --> ST
    SW -- executeScript on user click --> CS[Content script<br/>job-extraction]
    CS -- validated result --> SW
    SW --> SS[(session cache)]
  end
  CS -. reads DOM only .-> Page[Job posting page]
  SW -. Phase 3+ .-> API[API Gateway → Lambda → DynamoDB<br/>Cognito auth, Claude API]
```

More detail, including the extraction pipeline and planned AWS design, is in
[ARCHITECTURE.md](ARCHITECTURE.md). Design decisions and their reasoning are in
[DECISIONS.md](DECISIONS.md).

```
apps/extension/          Chrome extension (side panel, options, service worker, content script)
packages/shared/         Zod schemas, message contract, constants shared by every package
packages/job-extraction/ DOM-only, deterministic job extraction (JSON-LD, adapters, text signals)
tests/fixtures/jobs/     Fictional job pages used by unit and e2e tests
tests/e2e/               Playwright tests that load the built extension into Chromium
docs/                    Screenshots and the privacy policy draft
```

## Local setup

Requirements: Node.js 22.13 or newer, pnpm 10 (`corepack enable` provides it), Chrome 116 or newer.

```bash
pnpm install
pnpm build            # outputs apps/extension/dist
```

Load it in Chrome:

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose `apps/extension/dist`.
3. Pin ApplyPilot AI, open a job posting, and click the toolbar icon (or press Alt+Shift+A).
4. In the side panel, click **Analyze this page**.

Clicking the toolbar icon is what grants the extension access to the current page (`activeTab`).
If you switch tabs, click the icon again on the new tab before analyzing.

For development, `pnpm dev` rebuilds on change; reload the extension in `chrome://extensions`
after each build.

### Demo

Serve the fixtures with `node tests/e2e/fixture-server.mjs` and open
`http://127.0.0.1:4173/jobs/json-ld-cloud-intern.html` or
`http://127.0.0.1:4173/jobs/generic-devops-role.html`, then analyze them from the side panel.

## Environment variables

None are needed for Phase 1. See [.env.example](.env.example). Variables prefixed with `VITE_`
are embedded into the extension bundle, so secrets must never use that prefix; the Anthropic API
key will live only in the backend's secret store (Phase 3+).

## Testing

```bash
pnpm test            # unit + integration (Vitest, jsdom)
pnpm test:coverage   # with V8 coverage
pnpm test:e2e        # builds the e2e variant and runs Playwright in Chromium
pnpm verify          # typecheck, lint, format check, tests, production build
```

The e2e build is identical to the release build except that it is granted host access to
`http://127.0.0.1`, standing in for the toolbar click that automation cannot perform. If your
Playwright version does not match an installed Chromium, set `CHROMIUM_PATH` to a Chromium
binary.

## Security and privacy

Minimal permissions (`activeTab`, `scripting`, `sidePanel`, `storage`), no host permissions, no
remote code, strict CSP, runtime validation of every message, and no network requests in Phase 1.
See [SECURITY.md](SECURITY.md) and the [privacy policy draft](docs/PRIVACY.md).

## AWS, API and deployment

The backend has not been built. ARCHITECTURE.md describes the planned serverless design.
Deployment instructions, API documentation and a cost estimate will be added with Phase 6, and
nothing will be deployed without explicit approval.

## Known limitations

- Only Greenhouse-hosted boards have a dedicated adapter. Lever, Workday, SmartRecruiters and
  Ashby pages are detected but use generic extraction, and their results may be incomplete.
- Greenhouse boards embedded in an employer's site run in a cross-origin iframe, which is not read.
- The Greenhouse adapter was built against a fixture modeled on public Greenhouse markup and has
  not yet been checked against live postings.
- Skill detection uses a fixed vocabulary of 53 technologies, so it can miss niche tools.
- A bare `$` salary is reported with an unknown currency rather than assumed to be USD.
- Analysis requires a toolbar click per tab because the extension does not request broad host
  access.

## Roadmap

Phases 2 to 7 are listed in [PROGRESS.md](PROGRESS.md#next-recommended-steps): profile and resume
parsing with explainable matching, server-side Claude integration, user-approved autofill,
tracking and analytics, AWS infrastructure with CDK, and production hardening.

## Interview notes

What to be able to explain about each phase, and resume bullets limited to verified work:
[docs/INTERVIEW-NOTES.md](docs/INTERVIEW-NOTES.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
