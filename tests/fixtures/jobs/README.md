# Job posting fixtures

Local job pages used by unit, integration and end-to-end tests. No test depends on a live
third-party site. Companies, people and URLs are invented, except that
`indeed-search-selected-job.html` reproduces the header fields (title, company, location, pay,
job types) of the public Indeed posting from the first real-world test, so the regression test
matches what was reported. Its description text and the other result cards are invented. The
same holds for `indeed-embedded-sunstates.html` (header fields from the second report,
2026-10-15); `indeed-embedded-zs-connections.html` and its card are invented apart from the
company name and location the report showed.

| File                                  | Models                                                                                                       | Exercises                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `json-ld-cloud-intern.html`           | An employer careers page that publishes schema.org `JobPosting` JSON-LD                                      | Structured-data strategy, salary, deadline, `@graph` nesting               |
| `greenhouse-software-intern.html`     | A Greenhouse-hosted job board page (newer `.job__*` layout), no JSON-LD                                      | Greenhouse adapter, section parsing, application form detection            |
| `generic-devops-role.html`            | A plain careers page with headings and lists, no structured data                                             | Generic DOM strategy and text signals                                      |
| `not-a-job.html`                      | A blog article that mentions technologies                                                                    | Negative case: must not be reported as a job posting                       |
| `indeed-search-selected-job.html`     | An Indeed search results page: greeting header, result cards, selected-job pane                              | Indeed adapter scoping, "From" pay, several job types, stable job URL      |
| `indeed-viewjob.html`                 | A standalone Indeed job page (`/viewjob?jk=`)                                                                | Indeed header line pay and job type, location plus work arrangement        |
| `indeed-search-frame-panel.html`      | The second report: "Job Search \| Indeed" page, result cards, details in a same-origin frame                 | Selected-job scoping, no page-wide fallback, card/panel cross-check        |
| `indeed-embedded-sunstates.html`      | The frame content for the selected Sunstates Security job                                                    | Header fields from the report, single exact pay, one job type              |
| `indeed-embedded-zs-connections.html` | The frame content for another card, used to test switching jobs                                              | Job switching: never mixing the two jobs                                   |
| `indeed-homepage-feed.html`           | The third report: the homepage feed, generated class names, no search-page hooks, two "Police Officer" cards | Panel found by the selected card's title, bullet header line, cents in pay |

The Greenhouse and Indeed fixtures are modeled on those sites' public markup (`data-testid`
and id hooks), written without access to the live sites from the build environment. Live
markup changes; when a real page fails, save it (File → Save page as, or copy the
selected-job pane's outer HTML), trim personal details, and turn it into a fixture and test.
