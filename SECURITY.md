# Security

ApplyPilot handles résumés, contact details and job-search history, so security and privacy are
design constraints, not add-ons. This file lists what is implemented now and what is planned.

## Reporting a vulnerability

Please open a private security advisory on the GitHub repository rather than a public issue.

## Implemented (Phase 1)

| Control                                                                                                                            | Where                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Minimal permissions: `activeTab`, `scripting`, `sidePanel`, `storage`. No host permissions, no `tabs`, no declared content scripts | `apps/extension/src/manifest.ts`, enforced by `manifest.test.ts`       |
| Page access only after a user gesture (toolbar click grants `activeTab`)                                                           | `src/background/index.ts`                                              |
| Restricted pages (`chrome://`, Web Store, `file://`) are refused                                                                   | `src/background/router.ts`                                             |
| Strict extension CSP: `script-src 'self'; object-src 'self'`, no remote code, no `eval`                                            | manifest, enforced by test                                             |
| Runtime validation of every message with Zod, including replies from the content script                                            | `packages/shared/src/schemas/messages.ts`, `router.ts`, `messaging.ts` |
| Background accepts messages only from the extension's own pages (origin check)                                                     | `src/background/index.ts`                                              |
| Untrusted HTML is parsed into inert documents; scripts and handlers never run                                                      | `packages/job-extraction/src/text.ts`, covered by a test               |
| React rendering only (no `dangerouslySetInnerHTML`), so page text is always escaped                                                | UI components                                                          |
| Stored settings are validated on read and repaired field by field                                                                  | `src/storage/settings-repository.ts`                                   |
| AI processing consent defaults to off                                                                                              | `packages/shared/src/schemas/settings.ts`                              |
| No network requests in Phase 1; nothing leaves the browser                                                                         | whole codebase                                                         |
| Local data export and permanent deletion                                                                                           | Settings → Your data                                                   |
| Dependency audit (`pnpm audit --audit-level high`) in CI                                                                           | `.github/workflows/ci.yml`                                             |
| Pinned dependency versions and a lockfile                                                                                          | `package.json` files, `pnpm-lock.yaml`                                 |

## Planned

- Phase 3: server-side Claude calls only; the API key lives in AWS Secrets Manager and is never
  in the extension bundle (a build check will scan bundles for key patterns). Page content is
  passed to the model as clearly delimited, untrusted data, outputs are schema-validated, and
  the model cannot trigger actions.
- Phase 4: autofill never submits forms, never clicks submit or apply buttons, never fills
  passwords, legal attestations, eligibility, sponsorship or demographic questions, and only
  changes fields the user approved.
- Phase 6: Cognito JWT validation, per-user authorization on every item, API Gateway throttling,
  CORS limited to the extension origin, DynamoDB encryption with retention policies, and log
  redaction so résumé content and personal identifiers never reach CloudWatch.
- Phase 7: Chrome Web Store policy review and a third-party dependency review.
