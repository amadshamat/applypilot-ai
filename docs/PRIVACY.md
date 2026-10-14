# Privacy policy (draft)

_Draft for review before any public release. Not legal advice._

## Summary

ApplyPilot AI helps you understand job postings and prepare applications. In the current version
(0.2) **all data stays in your browser**. The extension makes no network requests. Resumes
are read and parsed on your device and are never uploaded.

## What is stored, and where

| Data                                                                                                     | Where                                 | When it is removed                                           |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------ |
| Settings (theme, AI consent, match weights)                                                              | `chrome.storage.local` on your device | When you delete local data or uninstall                      |
| The latest job analysis for each tab                                                                     | `chrome.storage.session` (memory)     | When the tab navigates or closes, or the browser exits       |
| Your profile (contact details, education, experience, skills, certifications, projects, job preferences) | `chrome.storage.local`                | When you delete local data or uninstall                      |
| Uploaded resume files, their extracted text and parsed drafts                                            | IndexedDB in the extension            | When you delete that resume, delete local data, or uninstall |

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

Settings → **Your data** lets you export everything ApplyPilot stores as JSON (including your profile and the text of
uploaded resumes) or delete it all. Individual resumes can be downloaded or deleted from the
Profile tab.
Uninstalling the extension also removes its local data.
