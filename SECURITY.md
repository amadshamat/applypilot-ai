# Security

ApplyPilot handles résumés, contact details and job-search history, so security and privacy are
design constraints, not add-ons. This file lists what is implemented now and what is planned.

## Reporting a vulnerability

Please open a private security advisory on the GitHub repository rather than a public issue.

## Implemented (Phase 1)

| Control                                                                                                                                     | Where                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Minimal permissions: `activeTab`, `scripting`, `sidePanel`, `storage`. No required host permissions, no `tabs`, no declared content scripts | `apps/extension/src/manifest.ts`, enforced by `manifest.test.ts`       |
| Page access only after a user gesture (toolbar click grants `activeTab`)                                                                    | `src/background/index.ts`                                              |
| Restricted pages (`chrome://`, Web Store, `file://`) are refused                                                                            | `src/background/router.ts`                                             |
| Strict extension CSP: `script-src 'self'; object-src 'self'`, no remote code, no `eval`                                                     | manifest, enforced by test                                             |
| Runtime validation of every message with Zod, including replies from the content script                                                     | `packages/shared/src/schemas/messages.ts`, `router.ts`, `messaging.ts` |
| Background accepts messages only from the extension's own pages (origin check)                                                              | `src/background/index.ts`                                              |
| Untrusted HTML is parsed into inert documents; scripts and handlers never run                                                               | `packages/job-extraction/src/text.ts`, covered by a test               |
| React rendering only (no `dangerouslySetInnerHTML`), so page text is always escaped                                                         | UI components                                                          |
| Stored settings are validated on read and repaired field by field                                                                           | `src/storage/settings-repository.ts`                                   |
| AI processing consent defaults to off                                                                                                       | `packages/shared/src/schemas/settings.ts`                              |
| No network requests except to the user's own ApplyPilot API (Phase 3)                                                                       | whole codebase                                                         |
| Local data export and permanent deletion                                                                                                    | Settings → Your data                                                   |
| Dependency audit (`pnpm audit --audit-level high`) in CI                                                                                    | `.github/workflows/ci.yml`                                             |
| Pinned dependency versions and a lockfile                                                                                                   | `package.json` files, `pnpm-lock.yaml`                                 |

## Implemented (Phase 3)

| Control                                                                                                                | Where                                                          |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Claude API key held only by the local API (`services/api/.env`, git-ignored, mode 600); never in the extension         | `services/api/src/config.ts`; `pnpm check:bundle` scans builds |
| Paid calls need two explicit settings (`APPLYPILOT_PROVIDER=anthropic` and a key); the default is free mock mode       | `config.ts`, `config.test.ts`                                  |
| API binds to 127.0.0.1, rejects non-localhost Host headers (DNS rebinding), allows only `chrome-extension://` origins  | `services/api/src/http.ts`, `http.test.ts`                     |
| Bearer token (random, 32 bytes) compared in constant time; 300 KB body cap; daily request limit                        | `app.ts`, `limiter.ts`, `app.test.ts`                          |
| Host access to 127.0.0.1/localhost is an optional permission, requested only when the user connects                    | `manifest.ts`, Settings → AI connection                        |
| Indeed frame access (`https://*.indeed.com/*`) is optional, requested only from a click when a job frame is unreadable | `manifest.ts`, `frame-access-alert.tsx`, DECISIONS 037         |
| A frame is read only when it shows the selected job's id; its reply is schema-validated like the page's                | `background/router.ts`, `router.test.ts`                       |
| Consent off by default; nothing is sent without a Generate click after a "What will be sent" preview                   | `features/ai`                                                  |
| Contact details, GPA, preferences and salary are never sent; storage ids are replaced by short refs                    | `packages/ai-core/src/context.ts`                              |
| Sensitive screening questions are filtered in the extension and again in the API                                       | `screening.ts`, `app.ts`                                       |
| Job text is fenced as untrusted data; fence-closing tags in it are removed (prompt injection)                          | `prompts.ts`, covered by a test                                |
| Structured outputs plus Zod validation on the API and again in the extension; the model cannot trigger any action      | `providers/anthropic.ts`, `ai-client.ts`                       |
| Deterministic grounding review of every draft against the local profile                                                | `grounding.ts`                                                 |
| Errors are mapped to safe messages; unexpected errors are hidden; logs never contain request content                   | `app.ts`, `anthropic.ts`                                       |
| The access token is excluded from data exports                                                                         | `data-controls.tsx`                                            |

## Implemented (Phase 4)

| Control                                                                                                   | Where                                           |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Scanning and filling only after a click in the side panel, on the active tab granted by the toolbar click | `background/router.ts`, `content/index.ts`      |
| No new permissions; no `host_permissions` in release builds                                               | `manifest.ts`, `manifest.test.ts`               |
| Never clicks submit or advance controls; blocks page submits and untrusted submit clicks while filling    | `autofill/src/fill.ts`, `dom.ts`, DECISIONS 039 |
| Fill refused when the tab moved to another page since the scan                                            | `router.ts` (`PAGE_CHANGED`), `router.test.ts`  |
| Passwords, read-only and disabled fields are never read or written; CAPTCHAs are never touched            | `scan.ts`, `scan.test.ts`                       |
| Sensitive questions locked: no proposal, no approval, never in fill instructions, never sent to AI        | `classify.ts`, `review.ts`, `mapping.ts`        |
| Scan results and fill results validated with Zod; page text treated as untrusted and length-limited       | `shared/src/schemas/autofill.ts`                |
| AI field matching sends labels only; answers restricted to non-sensitive profile kinds, review-only       | `ai.ts`, `ai-core/src/mapping.ts`, `app.ts`     |

## Implemented (Phase 5, and the Phase 4 review)

| Control                                                                                                                 | Where                                       |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Fill step re-checks each instruction on the live page: skips sensitive questions, password, hidden and invisible inputs | `autofill/src/fill.ts`, DECISIONS 043       |
| Content script answers only this extension and only schema-valid requests                                               | `content/index.ts`, `content/index.test.ts` |
| Tracker records validated on every read and write; unreadable entries kept, never silently dropped                      | `applications-repository.ts`                |
| Tracker data stays in `chrome.storage.local`; no network calls; included in Export data and Delete all                  | `data-controls.tsx`                         |
| CSV export neutralises formula cells (CSV injection) from page-sourced text                                             | `tracking/src/csv.ts`, `tracking.test.ts`   |
| Posting links open with `rel="noopener noreferrer"`; only http(s) addresses are stored                                  | `application-card.tsx`, `job-records.ts`    |
| One new permission, `alarms` (no install warning), for the hourly reminder badge                                        | `manifest.ts`, `manifest.test.ts`           |

## Implemented (Phase 6, built and tested locally; not deployed)

| Control                                                                                                                                                                  | Where                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| Sign-in on Cognito's hosted page with code flow + PKCE and a `state` check; the extension never handles passwords                                                        | `cloud/auth.ts`, `auth.test.ts`                 |
| Tokens only in `chrome.storage.session` (memory, not readable by content scripts); refresh token revoked on sign-out                                                     | `cloud/auth.ts`                                 |
| Public app client without a secret; callback only to the extension's `chromiumapp.org` address                                                                           | `infra/lib/applypilot-stack.ts`                 |
| Token checked twice: API Gateway Cognito authorizer, then signature, issuer, `token_use=access` and client id in Lambda                                                  | `cloud/auth.ts` (api), `cloud-api.test.ts`      |
| Every DynamoDB key built from the token's `sub`; tests prove users cannot read or change each other's data                                                               | `cloud/store.ts`, `cloud-api.test.ts`           |
| Strict zod validation of every body and response, 1 MB request and 300 KB item limits, structured errors                                                                 | `packages/sync/src/contract.ts`, `cloud/api.ts` |
| Rate limits: 120 requests per minute per user, API Gateway throttling (20/s, burst 40), daily AI quota, optional WAF                                                     | `cloud/api.ts`, stack                           |
| Least-privilege IAM: one role per function with exact actions on the table; only the account function can delete Cognito users; only the AI function can read the secret | stack, `stack.test.ts`                          |
| Encryption: TLS in transit (HSTS header), DynamoDB and Secrets Manager encrypted at rest; point-in-time recovery; deletion protection                                    | stack                                           |
| Logs hold route template, status, duration, a short user hash and an error code; no names, emails, record contents, tokens or IPs                                        | `cloud/api.ts`, access log format, tests        |
| The Claude key lives only in Secrets Manager; `pnpm check:bundle` still fails on key-like strings in the extension                                                       | stack, `scripts/check-bundle.mjs`               |
| Local test server: 127.0.0.1 only, Host and Origin checks, scrypt-hashed passwords, codes single-use and bound to the PKCE verifier                                      | `services/api/src/local`                        |
| cdk-nag AWS Solutions checks on every synth                                                                                                                              | `infra/bin/app.ts`, `stack.test.ts`             |

## Planned

- Phase 7: Chrome Web Store policy review and a third-party dependency review.
