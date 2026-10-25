# Privacy policy (draft)

_Draft for review before any public release. Not legal advice._

## Summary

ApplyPilot AI helps you understand job postings and prepare applications. In the current version
(0.6) your data stays in your browser unless you use the optional AI tools or turn on the
optional cloud sync. Resumes are read and
parsed on your device and are never uploaded. The AI tools send data only when **Allow AI
processing** is on, an ApplyPilot API is connected, and you press Generate after seeing what will
be sent.

## What is stored, and where

| Data                                                                                                                | Where                                                                 | When it is removed                                           |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------ |
| Settings (theme, AI consent, match weights)                                                                         | `chrome.storage.local` on your device                                 | When you delete local data or uninstall                      |
| The latest job analysis for each tab                                                                                | `chrome.storage.session` (memory)                                     | When the tab navigates or closes, or the browser exits       |
| Your profile (contact details, education, experience, skills, certifications, projects, job preferences)            | `chrome.storage.local`                                                | When you delete local data or uninstall                      |
| Uploaded resume files, their extracted text and parsed drafts                                                       | IndexedDB in the extension                                            | When you delete that resume, delete local data, or uninstall |
| AI connection (API address and access token)                                                                        | `chrome.storage.local`                                                | When you forget the token, delete local data, or uninstall   |
| The latest AI draft of each kind for each job (at most 30), with the request that produced it                       | `chrome.storage.local`                                                | When you discard it, delete local data, or uninstall         |
| Tracked applications: job details you saved or typed, statuses with dates, notes, follow-up reminders               | `chrome.storage.local`                                                | When you delete one, delete local data, or uninstall         |
| Cloud sync settings, the last-synced copy of each item, open conflicts, up to two backups (only if you set up sync) | `chrome.storage.local`                                                | When you disconnect, delete local data, or uninstall         |
| Cloud sign-in tokens (only if you sign in)                                                                          | `chrome.storage.session` (memory)                                     | When you sign out or the browser exits                       |
| Your profile and tracked applications in ApplyPilot Cloud (only if you turn on sync)                                | The ApplyPilot Cloud deployment you connect (AWS DynamoDB, encrypted) | When you use Delete cloud data or Delete account             |

## What the extension reads

Only the page in your current tab, and only after you click the ApplyPilot toolbar icon and then
**Analyze this page**. It reads the page's text and structured job data. It does not read
other tabs, your browsing history, passwords, cookies or payment information.

On Indeed, the selected job is sometimes shown in a frame from another Indeed address. If you
click **Allow reading Indeed job details**, Chrome lets ApplyPilot read Indeed pages too. It
still reads only when you click Analyze, and you can remove the access at any time from the
extension's details page in `chrome://extensions` (Site access). If you paste a job instead, only
the text you paste is read.

**Autofill.** When you click **Scan this form** in the Autofill tab, ApplyPilot reads the form
on the current tab: field labels, options and current values. It never reads password fields.
It changes only the fields you approved, and only when you click **Fill**. It never clicks
Submit, Apply or Next. Answers come from your saved profile and resume on your device; nothing
is sent anywhere unless you use one of the optional AI buttons below.

**Copy details for a bug report** copies the page address, how each field was found, and, when
no job was found, an outline of the page's element names and frame addresses. It contains no text
from the page.

## Sharing

Nothing is shared or sold. No analytics or tracking are included.

## AI features

**What is sent.** For the job: its title, company, location, description and listed
qualifications and skills. From your profile: your summary, roles with their bullets, projects,
education, certifications and skill names; your name only for cover letters; the notes you type
for a cover letter; and the screening questions you paste. Never sent: email, phone, location,
links, GPA, job preferences, salary expectations, resume files, and screening questions about
work authorization, legal matters, demographics, pay or availability.

**Autofill AI help.** **Match fields with AI** sends only the labels, hints, section names and
options of form fields ApplyPilot could not recognise, and nothing from your profile. **Draft
answers with AI Tailor** sends the form's open questions with the same profile data as
screening drafts. Questions about work authorization, demographics, pay, consent or similar are
never sent.

**To whom.** To the ApplyPilot API you run on your own computer (`127.0.0.1`). In mock mode
nothing goes further. With Claude enabled, the API forwards the request to Anthropic, the AI
provider, using your own Anthropic account; Anthropic's commercial terms and privacy policy
govern its handling and retention of that data. ApplyPilot does not operate a server and keeps
no copy outside your browser.

**Logs.** The local API prints the route, status, duration, model and token counts of each
request. It never logs the content.

## Cloud sync (optional)

Off by default. When you connect a deployment, sign in and turn on sync, your profile and
tracked applications (with statuses, notes and reminders) are copied to that ApplyPilot Cloud
deployment so your other browsers can sync them. Resume files, AI drafts, settings and the local
AI token are never uploaded.

- **Account.** Created on Amazon Cognito's sign-in page. ApplyPilot never sees your password.
  Cognito stores your email address and a password hash.
- **Who can read it.** Only requests signed with your account's token; every stored item is
  keyed by your account id. Data is encrypted in transit (HTTPS) and at rest.
- **Logs.** Each request is logged with its route, status, duration, an error code and a short
  one-way hash of your account id, kept 30 days. No names, emails, record contents, tokens or IP
  addresses.
- **Your controls.** Settings → Cloud sync: **Export cloud data** (everything stored, as JSON),
  **Delete cloud data** (keeps your account), **Delete account** (data and account), **Sign
  out**, and turning sync off. Deleting cloud data never deletes what is in your browser.
- **Backups.** The AWS table keeps point-in-time recovery for 35 days, so a deleted item can
  remain in AWS backups for up to 35 days before it expires.

Version 0.6 is not deployed to a public server; this section applies to a deployment run by
whoever operates it (for now, only a deployment you run in your own AWS account).

## Your controls

Settings → **Your data** lets you export everything ApplyPilot stores as JSON (including your
profile and, since 0.7.0, your original resume files, so keep the file private), import such a
file back, or delete it all. An import is read in this browser only, checked before anything is
saved, and never contains or restores the access token or cloud settings. Delete all also
removes the page analyses Chrome keeps for the current session. Individual resumes can be
downloaded or deleted from the Profile tab.
The AI tools have a **Discard draft** button, and Settings → **AI connection** has **Forget
token**. Exports never include the access token. Uninstalling the extension also removes its
local data.
