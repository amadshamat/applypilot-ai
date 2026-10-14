# Install and test ApplyPilot AI in Google Chrome

This loads the Phase 1 build as an unpacked extension. You need desktop Google Chrome 116 or
newer (check at `chrome://settings/help`).

## 1. Download

Download `applypilot-ai-extension-0.1.0.zip` from the project files.

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

Windows "Extract All" adds an outer folder (`applypilot-ai-extension-0.1.0`). Open it and choose
the `applypilot-ai-extension` folder inside.

## 4. Load it in Chrome

1. Go to `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `applypilot-ai-extension` folder from step 3.
4. The **ApplyPilot AI** card appears with version 0.1.0 and no red **Errors** button.
5. Click the puzzle-piece icon in the toolbar and pin **ApplyPilot AI**.

## 5. Manual test checklist

| #   | Do this                                                                                                                                                                            | Expected                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1   | Click the ApplyPilot icon on any normal web page                                                                                                                                   | Side panel opens on the right with six tabs                                                                               |
| 2   | Click each tab, then use the arrow keys on the tab bar                                                                                                                             | Each opens; Autofill, Resume, Applications and AI Copilot say "Not built yet"                                             |
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

## Troubleshooting

| Problem                                                     | Fix                                                                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| "Manifest file is missing or unreadable"                    | You picked the outer folder. Select the one that directly contains `manifest.json`                                 |
| Clicking the icon does nothing                              | Update Chrome to 116+. Then open `chrome://extensions`, click **Errors** on the ApplyPilot card, and send the text |
| "Permission needed for this page"                           | Click the ApplyPilot toolbar icon while that tab is open, then analyze again. Access is granted per tab, by design |
| Wrong or missing values on a real posting                   | Expected sometimes; only Greenhouse has a dedicated adapter. Send the page URL and a screenshot                    |
| "Disable developer mode extensions" popup at Chrome startup | Normal for unpacked extensions; choose to keep it                                                                  |
| After a new build                                           | Replace the folder contents, then click the reload arrow on the ApplyPilot card                                    |
