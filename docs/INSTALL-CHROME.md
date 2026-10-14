# Install and test ApplyPilot AI in Google Chrome

This loads the Phase 1 build as an unpacked extension. You need desktop Google Chrome 116 or
newer (check at `chrome://settings/help`).

## 1. Download

Download `applypilot-ai-extension-0.2.0.zip` from the project files.

## 2. Extract

- **Windows:** right-click the zip → **Extract All…** → **Extract**.
- **macOS:** double-click the zip in Finder.

Move the extracted folder somewhere permanent, such as `Documents/ApplyPilot`. Chrome loads the
extension from this folder every time it starts, so do not delete or move it after loading.

## 3. Find the right folder

Pick the folder that **directly contains `manifest.json`**. It is named
`applypilot-ai-extension` and holds:

```
applypilot-ai-extension/
├── manifest.json
├── background.js
├── content.js
├── sidepanel.html
├── options.html
├── assets/
└── icons/
```

Windows "Extract All" adds an outer folder (`applypilot-ai-extension-0.2.0`). Open it and choose
the `applypilot-ai-extension` folder inside.

## 4. Load it in Chrome

1. Go to `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `applypilot-ai-extension` folder from step 3.
4. The **ApplyPilot AI** card appears with version 0.2.0 and no red **Errors** button.
5. Click the puzzle-piece icon in the toolbar and pin **ApplyPilot AI**.

## 5. Manual test checklist

| #   | Do this                                                                                                                                                                            | Expected                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1   | Click the ApplyPilot icon on any normal web page                                                                                                                                   | Side panel opens on the right with six tabs                                                                               |
| 2   | Click each tab, then use the arrow keys on the tab bar                                                                                                                             | Each opens; Autofill, Applications and AI Copilot say "Not built yet"; Profile shows "Build your profile"                 |
| 3   | Settings tab: set Theme to Dark, click **Save settings**                                                                                                                           | Panel turns dark and "Settings saved" appears                                                                             |
| 4   | Click **Open in a tab** in Settings                                                                                                                                                | Full settings page opens with Theme already set to Dark                                                                   |
| 5   | Set one match weight so the total isn't 100                                                                                                                                        | Total turns red and **Save settings** is disabled                                                                         |
| 6   | Open a single job posting (for example any posting on `job-boards.greenhouse.io` or a company careers page), click the ApplyPilot icon **on that tab**, then **Analyze this page** | Title, company, location and other fields appear, each with a confidence and source badge; missing fields say "Not found" |
| 7   | Compare the results with the page                                                                                                                                                  | Values match the page; nothing appears that the page doesn't say                                                          |
| 8   | Switch to another tab and click **Re-analyze** without clicking the icon                                                                                                           | "Permission needed for this page". Clicking the icon on that tab fixes it                                                 |
| 9   | Open `chrome://extensions` and analyze                                                                                                                                             | "This page cannot be analyzed"                                                                                            |
| 10  | Open a job search results page (a list of jobs) and analyze                                                                                                                        | Usually "This may not be a job posting"                                                                                   |
| 11  | Settings → **Export data**                                                                                                                                                         | A JSON file downloads                                                                                                     |
| 12  | Settings → **Delete all local data** → **Yes, delete everything**                                                                                                                  | Confirmation message; settings return to defaults                                                                         |

## 6. Phase 2 checklist: profile, resume and match

Use your own resume for these. Everything stays in your browser.

| #   | Do this                                                                                                      | Expected                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Open the **Profile** tab                                                                                     | "Build your profile" with **Upload a resume** and **Fill in by hand**                                                                                                                                                                   |
| P2  | **Upload a resume**, then drop or choose your PDF resume                                                     | "Reading…" then a **Review** screen listing the sections found                                                                                                                                                                          |
| P3  | Compare every section with your resume                                                                       | Name, contact links, schools, jobs, dates, bullets, skills, projects and certifications match your resume. Nothing appears that your resume doesn't say. Anything uncertain is listed under "Please double-check"                       |
| P4  | Fix anything wrong (open an entry with the pencil, edit, **Done**); delete an entry you don't want           | Changes show in the summary line; deleting asks for confirmation                                                                                                                                                                        |
| P5  | Type a bad date such as "May 2024" and press **Save to profile**                                             | Save is blocked and the field says "Use YYYY or YYYY-MM"                                                                                                                                                                                |
| P6  | Fix it and **Save to profile**                                                                               | "Profile updated" and the Profile view shows your data                                                                                                                                                                                  |
| P7  | Upload the Word (.docx) version if you have one                                                              | Similar result. Saving offers **Add what's new** (default) or **Replace my profile**                                                                                                                                                    |
| P8  | Choose **Add what's new** and save                                                                           | Message says what was added and how many duplicates were skipped; your edits from P4 are kept                                                                                                                                           |
| P9  | Close and reopen the side panel, open Profile                                                                | Everything is still there                                                                                                                                                                                                               |
| P10 | Profile → **Resumes**                                                                                        | Each upload is listed with date and size; download gives back the original file; delete asks first and doesn't change your profile                                                                                                      |
| P11 | Add a skill such as "k8s", set Job preferences (for example Remote, Internship, your city), **Save profile** | "Profile saved."; the skill is categorised as DevOps                                                                                                                                                                                    |
| P12 | Open a real posting you're interested in, click the toolbar icon, **Analyze this page**                      | Job details, then **Match with your profile** with a score out of 100, a breakdown by part, skill chips (green you have it, amber related, red missing), "Where your profile shows these", gaps, "Check these yourself" and suggestions |
| P13 | Check the evidence                                                                                           | Each matched skill names a real entry of yours; nothing is marked as matched that you don't list                                                                                                                                        |
| P14 | Read the suggestions                                                                                         | None asks you to claim a skill or number you don't have; missing skills say "only if you genuinely have them"                                                                                                                           |
| P15 | Settings: change weights (still totalling 100), save, return to Analyze                                      | The score changes accordingly                                                                                                                                                                                                           |
| P16 | Try a scanned PDF or a .doc file if you have one                                                             | A clear message explains why it can't be read                                                                                                                                                                                           |
| P17 | Settings → **Delete all local data** → confirm                                                               | Profile and resumes are gone; Profile shows "Build your profile" again                                                                                                                                                                  |

Please send screenshots of anything that looks wrong, especially P3, with the part of the resume
it came from (you can cover personal details).

## Updating to a new build

Chrome keeps running the files in the folder you loaded, so updating means replacing them.

1. Download and extract the new zip.
2. Open `chrome://extensions` and find the **ApplyPilot AI** card.
3. Either click **Remove** and then **Load unpacked** with the new `applypilot-ai-extension`
   folder, or copy the new folder's contents over the old folder's contents and click the
   circular **Reload** arrow on the card.
4. Check that the card shows the new version number.
5. Reload any job tabs that were open before the update (Ctrl+R or Cmd+R), so nothing from the
   old version is left on the page.
6. Click the ApplyPilot toolbar icon on the job tab again before analyzing.

Removing the extension also deletes its saved settings, profile and resumes. Reloading keeps
them. Before removing, use Settings → **Export data** if you want a copy.

## Troubleshooting

| Problem                                                     | Fix                                                                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| "Manifest file is missing or unreadable"                    | You picked the outer folder. Select the one that directly contains `manifest.json`                                 |
| Clicking the icon does nothing                              | Update Chrome to 116+. Then open `chrome://extensions`, click **Errors** on the ApplyPilot card, and send the text |
| "Permission needed for this page"                           | Click the ApplyPilot toolbar icon while that tab is open, then analyze again. Access is granted per tab, by design |
| Wrong or missing values on a real posting                   | Expected sometimes; only Greenhouse has a dedicated adapter. Send the page URL and a screenshot                    |
| "Disable developer mode extensions" popup at Chrome startup | Normal for unpacked extensions; choose to keep it                                                                  |
| After a new build                                           | See "Updating to a new build" above                                                                                |
