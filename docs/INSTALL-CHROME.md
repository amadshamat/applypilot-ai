# Install and test ApplyPilot AI in Google Chrome

This loads the current build (0.4.1) as an unpacked extension. You need desktop Google Chrome 116 or
newer (check at `chrome://settings/help`).

## 1. Download

Download `applypilot-ai-extension-0.4.1.zip` from the project files.

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

Windows "Extract All" adds an outer folder (`applypilot-ai-extension-0.4.1`). Open it and choose
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

## 5a. Indeed check (v0.3.3)

Use any Indeed search with several results, for example security officer jobs in Alexandria, VA.
Repeat I1 and I3 on the Indeed homepage feed ("Matches your preferences").

| #   | Do this                                                                                                                           | Expected                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | Click a job in the results, wait until its details show on the right, click the ApplyPilot icon, then **Analyze this page**       | Title, company, location, pay and job type match the right-hand panel. Never "Job Search \| Indeed", and nothing from other cards in the list |
| I2  | Open **How this was read** under the job details                                                                                  | "Read from the job details panel", "The details panel … matches the selected result", and no red items                                        |
| I3  | Click a different job in the results list (do not reload the page)                                                                | The side panel shows "The selected job changed"; the AI Tailor tab shows the same notice and no Generate buttons                              |
| I4  | Click **Analyze selected job**                                                                                                    | The new job's details, with nothing left over from the first job                                                                              |
| I5  | Click a job and analyze immediately, before its details finish loading                                                            | Either the new job, or a note asking you to wait and analyze again. Never the previous job's details                                          |
| I6  | If you see **Indeed shows this job in a protected frame**, click **Allow reading Indeed job details** and accept Chrome's prompt  | The analysis runs again and shows the open job. Chrome asks once; the access covers Indeed pages only                                         |
| I7  | Click **Paste the job instead**, copy the job's text from the right-hand panel, paste it, enter the title, **Analyze pasted job** | The pasted job is analyzed; fields you typed show "You entered", and nothing from other results appears                                       |

If any value is wrong, open **How this was read**, click **Copy details for a bug report** and
paste it with a screenshot. The copy has the page address, field sources and checks, but no job
text or profile data.

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

## 7. Phase 3 checklist: AI drafts

The AI tools talk to the ApplyPilot API, a small program you run on your computer that keeps the
Claude API key out of the browser. Start in **mock mode**: it is free, sends nothing anywhere, and
tests the whole flow. Mock drafts reorder and quote your own text; they are not real rewrites.

**Run the API (once per session).** You need Node.js 22 or newer
([nodejs.org](https://nodejs.org)). In a terminal, in the `applypilot-ai` source folder from the
project files:

```bash
corepack enable        # once, provides pnpm
pnpm install           # once
pnpm api:setup         # once: creates services/api/.env and prints your access token
pnpm api               # starts the API; leave this window open
```

`pnpm api` prints "listening on http://127.0.0.1:8787" and "Provider: mock". Copy the token that
`pnpm api:setup` printed (it is also the `APPLYPILOT_LOCAL_TOKEN` line in `services/api/.env`).

| #   | Do this                                                                                                                                                                | Expected                                                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | With your profile saved, analyze a job, then open the **AI Tailor** tab                                                                                                | "AI processing is off" with an explanation and **Allow AI processing**. Nothing has been sent                                                                                     |
| A2  | Click **Allow AI processing**                                                                                                                                          | "Connect the ApplyPilot API" with **Open Settings**                                                                                                                               |
| A3  | Settings → **AI connection**: keep `http://127.0.0.1:8787`, paste the token, **Save and test connection**                                                              | Chrome asks once to let ApplyPilot access 127.0.0.1; choose **Allow**. Then "Connected to ApplyPilot API 0.3.0" and "Mock mode: free drafts…"                                     |
| A4  | Try a wrong token and test again                                                                                                                                       | "Not connected: Missing or wrong access token." Put the right token back                                                                                                          |
| A5  | **AI Tailor** → **Resume**: open **What will be sent**, then **Show the exact data**                                                                                   | The job and your summary, roles, projects, education, certifications and skills. No email, phone, location, links, GPA or salary                                                  |
| A6  | **Generate tailored resume**                                                                                                                                           | Your bullets, most relevant first, each with "Based on your original"; skills to feature; "The job asks for things your profile does not show". The `pnpm api` window logs a line |
| A7  | **Copy** and paste into a document; try **Download .txt**                                                                                                              | Plain text resume sections; your saved profile is unchanged                                                                                                                       |
| A8  | Close and reopen the side panel, analyze the same job, open **AI Tailor**                                                                                              | The draft is still there, marked "saved", and no new request is logged                                                                                                            |
| A9  | **Cover letter**: choose a tone and length, type a note (for example why you like the company), **Generate**                                                           | An editable letter starting "Dear Hiring Manager," and ending with your name. Your note appears. You can edit and copy it                                                         |
| A10 | **Questions**: paste "Why do you want this role?", "Describe a project you are proud of.", "Do you require visa sponsorship?" and "What is your gender?", one per line | The last two are marked **You answer** with the reason; the button says **Draft 2 answers**                                                                                       |
| A11 | **Draft 2 answers**                                                                                                                                                    | Two editable drafts with "Add yourself:" notes. The two sensitive questions are not drafted and were never sent                                                                   |
| A12 | Stop the API (Ctrl+C in its window), then **Generate again**                                                                                                           | "Could not reach the ApplyPilot API… Is it running?"                                                                                                                              |
| A13 | Settings → turn **Allow AI processing** off and save; open AI Tailor                                                                                                   | Back to "AI processing is off"                                                                                                                                                    |
| A14 | Settings → **Export data**                                                                                                                                             | The export includes your drafts; the token shows as "(not exported)"                                                                                                              |

**Optional: real Claude drafts (costs money).** Only after you approve the cost: create an API
key at [console.anthropic.com](https://console.anthropic.com), then in `services/api/.env` set
`APPLYPILOT_PROVIDER=anthropic` and `ANTHROPIC_API_KEY=<your key>`, and restart `pnpm api`. It
should say "Provider: Claude (claude-opus-5-5, effort medium)". Each draft costs about
$0.05–$0.25; the preview shows the upper bound first, and each draft shows its real cost. Check
that the drafts read naturally, stay truthful, and that any "Check:" flags make sense. Never put
the key anywhere in the extension.

## 8. Phase 4 checklist: Autofill (v0.4.0)

Tick each box as you go (update first, as in "Updating to a new build" below). If anything fails, note the step number, take a screenshot of the side
panel and the page, and send both. **Never submit a real application during this test unless you
actually mean to apply.** ApplyPilot itself never clicks Submit, Apply or Next.

### Practice form (quickest start)

`practice-application.html` (in the project files, and in the source under
`tests/fixtures/applications/`) is a single practice form that cannot submit anything. Chrome
extensions cannot scan `file://` pages here, so serve it from your own computer:

1. Put the file in a folder of its own, for example `~/Downloads/applypilot-practice`.
2. In Terminal: `cd ~/Downloads/applypilot-practice` then
   `python3 -m http.server 8000 --bind 127.0.0.1` (keep the window open; Ctrl+C stops it).
3. In Chrome open `http://127.0.0.1:8000/practice-application.html`.
4. Click the ApplyPilot toolbar icon on that tab, open **Autofill**, click **Scan this form**,
   review, then **Fill N approved fields**. The page should still say "Submit attempts: 0".

### B. Sample forms (safe, nothing is sent anywhere)

In the source folder (`applypilot-ai-source-0.4.1`, after `pnpm install`), run
`node tests/e2e/fixture-server.mjs` and keep the window open. For each form below: open the
address, click the ApplyPilot toolbar icon on that tab, open **Autofill**, click **Scan this
form**.

**B1. Generic form:** `http://127.0.0.1:4173/applications/generic-application.html`

- [ ] Title "Apply for Cloud Engineering Intern", platform "Application form" with an
      **Experimental** badge.
- [ ] **Ready to fill** shows your name, email and phone, each with a source such as
      "Profile · Email" and a confidence.
- [ ] **You answer these on the page** lists Gender, Veteran status, Desired salary and the work
      authorization question, with a lock and no checkbox.
- [ ] Untick one field (for example Phone), edit another value, type something into a
      **Missing from your profile** field.
- [ ] Click **Fill N approved fields**. The results card says what was filled; the unticked field
      stays empty on the page; the edited value is what appears on the page.
- [ ] Your resume shows as attached in the file field.
- [ ] The page does **not** show "Submitted!" and stayed on the same page.
- [ ] Copy button next to a field copies its value (paste it somewhere to check).

**B2. Workday-style, multi-step:** `.../applications/workday-application.html`

- [ ] The summary shows "Step 1 of 4" and the notice "More steps may follow".
- [ ] The Country and State dropdowns fill correctly; the page stays on step 1.
- [ ] Click the page's own **Next**, then **Scan again**: step 2 fields appear, with your
      experience entries mapped to the matching blocks.
- [ ] Nothing reaches "Application submitted".

**B3. Greenhouse-style:** `.../applications/greenhouse-application.html`

- [ ] Typeahead dropdowns (school, degree) are filled, or a clear "No option matching…" message
      appears for a value that is not in the list.
- [ ] Demographic questions are in **You answer these on the page**.

**B4. Others:** `lever-application.html`, `ashby-application.html`,
`smartrecruiters-application.html`, `indeed-apply.html`

- [ ] Each scans without errors and fills the basic contact fields.
- [ ] Lever: the CAPTCHA notice appears and nothing touches it.
- [ ] Ashby: Yes/No button questions are listed under **Not recognised or not supported**.
- [ ] Indeed: the read-only email is counted as skipped, not changed.

### C. Errors and safety

- [ ] C1. Scan, then navigate the same tab to another page and click **Fill**: it refuses with
      "This tab now shows a different page. Scan the form again."
- [ ] C2. On `chrome://extensions` or a new tab page, **Scan this form** shows a clear message,
      not a crash.
- [ ] C3. On a page you have not clicked the toolbar icon for, the scan asks you to click it.
- [ ] C4. A login page: the password field is never shown, filled or read.

### D. AI help (optional, mock mode is free)

Only with `pnpm api` running in mock mode and **Allow AI processing** on.

- [ ] D1. **Match fields with AI** appears only when consent is on and the API is connected.
- [ ] D2. After clicking it, matched fields appear under **Check these**, marked "AI-matched", and
      are **not** ticked.
- [ ] D3. **Draft answers with AI Tailor** fills open questions with drafts marked for review;
      sensitive questions stay locked.
- [ ] D4. With AI processing off, neither AI button is shown.

### E. Live sites (experimental, do not submit)

Pick one or two real job applications you are willing to fill but not send (for example a
Greenhouse or Lever internship). Sign in yourself where a site needs it.

- [ ] E1. Platform name is right and the badge says **Experimental**.
- [ ] E2. Most contact, link and education fields are proposed with the right values.
- [ ] E3. Sensitive questions are locked.
- [ ] E4. **Fill** changes only the ticked fields, and the site does not show errors such as
      "required" on fields that look filled (if it does, note which).
- [ ] E5. Nothing is submitted and the page does not move to another step by itself.
- [ ] E6. Note any field that was wrong, missing or not recognised, with the site name.

When a live platform passes E1 to E5, report it so it can be marked **Verified** in PROGRESS.md.

## Updating to a new build

Chrome keeps running the files in the folder you loaded, so updating means replacing them. To
**keep your profile, resumes, settings and AI drafts**, replace the files and reload; do not
remove the extension.

1. Download and extract the new zip.
2. Copy everything inside the new `applypilot-ai-extension` folder over the contents of the
   folder Chrome already loads (the one you picked in **Load unpacked**), replacing all files.
3. Open `chrome://extensions` and click the circular **Reload** arrow on the **ApplyPilot AI**
   card.
4. Check that the card shows the new version number and no **Errors** button.
5. Reload any job or application tabs that were open before the update (Ctrl+R or Cmd+R), so
   nothing from the old version is left on the page.
6. Click the ApplyPilot toolbar icon on the tab again before analyzing or scanning.

Your data lives in the extension's own storage, which Chrome keys to the extension's id. Loading
from the same folder keeps the same id, so Reload keeps everything. **Remove** (or loading the
new build from a different folder) starts with empty storage. If you must remove it, use
Settings → **Export data** first.

## Troubleshooting

| Problem                                                        | Fix                                                                                                                                                  |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Manifest file is missing or unreadable"                       | You picked the outer folder. Select the one that directly contains `manifest.json`                                                                   |
| Clicking the icon does nothing                                 | Update Chrome to 116+. Then open `chrome://extensions`, click **Errors** on the ApplyPilot card, and send the text                                   |
| "Permission needed for this page"                              | Click the ApplyPilot toolbar icon while that tab is open, then analyze again. Access is granted per tab, by design                                   |
| Wrong or missing values on a real posting                      | Expected sometimes outside Greenhouse and Indeed. Open **How this was read**, click **Copy details for a bug report**, and send it with a screenshot |
| "The selected job changed"                                     | You picked another job on the page after analyzing. Click **Analyze selected job**                                                                   |
| "The job details panel is still showing a different job"       | Indeed had not finished loading the job you clicked. Wait until its details appear on the right, then analyze again                                  |
| "Indeed shows this job in a protected frame"                   | Click **Allow reading Indeed job details** and accept Chrome's prompt, or use **Paste the job instead**                                              |
| Still "No job is open" on Indeed with a job open               | Open **How this was read**, click **Copy details for a bug report**, and send it. It includes an outline of the page's structure, but no job text    |
| "Disable developer mode extensions" popup at Chrome startup    | Normal for unpacked extensions; choose to keep it                                                                                                    |
| Autofill: "ApplyPilot needs your permission to read this page" | Click the toolbar icon while the form's tab is open, then **Scan this form** again                                                                   |
| Autofill: "This tab now shows a different page"                | The page changed after the scan (for example a new step). Click **Scan again**                                                                       |
| Autofill: a field looks filled but the site says "required"    | Type the value yourself, or use the field's copy button and paste it. Send the site name and the field's label                                       |
| Autofill: "The form is inside a frame from another site"       | Use the link in the notice to open the form in its own tab, then scan there                                                                          |
| After a new build                                              | See "Updating to a new build" above                                                                                                                  |
| "Could not reach the ApplyPilot API"                           | Start it with `pnpm api` in the source folder and keep the window open; check the address in Settings                                                |
| "Missing or wrong access token"                                | Copy `APPLYPILOT_LOCAL_TOKEN` from `services/api/.env` into Settings → AI connection again                                                           |
| `pnpm api` says "not configured"                               | Run `pnpm api:setup` first; it creates `services/api/.env`                                                                                           |
| "The Claude API rejected the API key"                          | Check `ANTHROPIC_API_KEY` in `services/api/.env`, then restart `pnpm api`                                                                            |
| "The daily limit … has been reached"                           | It resets at midnight, or raise `APPLYPILOT_DAILY_LIMIT` and restart                                                                                 |
