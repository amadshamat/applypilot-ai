# Privacy policy (draft)

_Draft for review before any public release. Not legal advice._

## Summary

ApplyPilot AI helps you understand job postings and prepare applications. In the current version
(0.3) your data stays in your browser unless you use the optional AI tools. Resumes are read and
parsed on your device and are never uploaded. The AI tools send data only when **Allow AI
processing** is on, an ApplyPilot API is connected, and you press Generate after seeing what will
be sent.

## What is stored, and where

| Data                                                                                                     | Where                                 | When it is removed                                           |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------ |
| Settings (theme, AI consent, match weights)                                                              | `chrome.storage.local` on your device | When you delete local data or uninstall                      |
| The latest job analysis for each tab                                                                     | `chrome.storage.session` (memory)     | When the tab navigates or closes, or the browser exits       |
| Your profile (contact details, education, experience, skills, certifications, projects, job preferences) | `chrome.storage.local`                | When you delete local data or uninstall                      |
| Uploaded resume files, their extracted text and parsed drafts                                            | IndexedDB in the extension            | When you delete that resume, delete local data, or uninstall |
| AI connection (API address and access token)                                                             | `chrome.storage.local`                | When you forget the token, delete local data, or uninstall   |
| The latest AI draft of each kind for each job (at most 30), with the request that produced it            | `chrome.storage.local`                | When you discard it, delete local data, or uninstall         |

## What the extension reads

Only the page in your current tab, and only after you click the ApplyPilot toolbar icon and then
**Analyze this page**. It reads the page's text and structured job data. It does not read
other tabs, your browsing history, passwords, cookies or payment information.

On Indeed, the selected job is sometimes shown in a frame from another Indeed address. If you
click **Allow reading Indeed job details**, Chrome lets ApplyPilot read Indeed pages too. It
still reads only when you click Analyze, and you can remove the access at any time from the
extension's details page in `chrome://extensions` (Site access). If you paste a job instead, only
the text you paste is read.

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

**To whom.** To the ApplyPilot API you run on your own computer (`127.0.0.1`). In mock mode
nothing goes further. With Claude enabled, the API forwards the request to Anthropic, the AI
provider, using your own Anthropic account; Anthropic's commercial terms and privacy policy
govern its handling and retention of that data. ApplyPilot does not operate a server and keeps
no copy outside your browser.

**Logs.** The local API prints the route, status, duration, model and token counts of each
request. It never logs the content.

Account sync through a hosted ApplyPilot server is planned for a later version; this policy will
be updated before it ships.

## Your controls

Settings → **Your data** lets you export everything ApplyPilot stores as JSON (including your profile and the text of
uploaded resumes) or delete it all. Individual resumes can be downloaded or deleted from the
Profile tab.
The AI tools have a **Discard draft** button, and Settings → **AI connection** has **Forget
token**. Exports never include the access token. Uninstalling the extension also removes its
local data.
