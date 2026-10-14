# Contributing

## Setup

```bash
corepack enable
pnpm install
pnpm verify   # typecheck, lint, format check, tests, build
```

## Workflow

- Branch from `main`, keep changes small, and open a pull request. CI must pass.
- Run `pnpm format` before committing.
- Every bug fix comes with a regression test. Extraction changes come with a fixture in
  `tests/fixtures/jobs` (fictional companies only, never copied personal data).
- Never claim a site is supported until a fixture-based test covers it.
- Update `PROGRESS.md` when a feature's state changes and `DECISIONS.md` when you make a choice
  someone would otherwise have to rediscover.

## Code conventions

- TypeScript strict mode, including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- Data crossing a boundary (messages, storage, network, the page) is validated with the shared
  Zod schemas.
- Components reach browser APIs through `AppServices`, never `chrome.*` directly.
- Prefer small, named modules over large components; no new dependency without a reason in the PR.

## Adding a site adapter

1. Add a fixture page modeled on the platform's public markup.
2. Implement `SiteAdapter` in `packages/job-extraction/src/adapters/` and register it in
   `adapters/index.ts`.
3. Add tests in `packages/job-extraction/test/` asserting each field and its confidence.
4. Document the adapter's coverage and limits in the fixture README.
