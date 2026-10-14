# Privacy policy (draft)

_Draft for review before any public release. Not legal advice._

## Summary

ApplyPilot AI helps you understand job postings and prepare applications. In the current version
(0.1, Phase 1) **all data stays in your browser**. The extension makes no network requests.

## What is stored, and where

| Data                                        | Where                                 | When it is removed                                     |
| ------------------------------------------- | ------------------------------------- | ------------------------------------------------------ |
| Settings (theme, AI consent, match weights) | `chrome.storage.local` on your device | When you delete local data or uninstall                |
| The latest job analysis for each tab        | `chrome.storage.session` (memory)     | When the tab navigates or closes, or the browser exits |

## What the extension reads

Only the page in your current tab, and only after you click the ApplyPilot toolbar icon and then
**Analyze this page**. It reads the page's text and structured job data. It does not read
other tabs, your browsing history, passwords, cookies or payment information.

## Sharing

Nothing is shared or sold. No analytics or tracking are included.

## Future versions

Later versions may offer AI features and account sync through an ApplyPilot server. Those
features will be off until you turn on **Allow AI processing**, and this policy will be updated
to describe exactly what is sent, to whom (for example Anthropic as the AI provider), how long it
is retained, and how to delete it, before any such feature ships.

## Your controls

Settings → **Your data** lets you export everything ApplyPilot stores as JSON or delete it.
Uninstalling the extension also removes its local data.
