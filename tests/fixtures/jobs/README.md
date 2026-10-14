# Job posting fixtures

Local, fictional job pages used by unit, integration and end-to-end tests. Companies,
people and URLs are invented. No test depends on a live third-party site.

| File                              | Models                                                                  | Exercises                                                       |
| --------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| `json-ld-cloud-intern.html`       | An employer careers page that publishes schema.org `JobPosting` JSON-LD | Structured-data strategy, salary, deadline, `@graph` nesting    |
| `greenhouse-software-intern.html` | A Greenhouse-hosted job board page (newer `.job__*` layout), no JSON-LD | Greenhouse adapter, section parsing, application form detection |
| `generic-devops-role.html`        | A plain careers page with headings and lists, no structured data        | Generic DOM strategy and text signals                           |
| `not-a-job.html`                  | A blog article that mentions technologies                               | Negative case: must not be reported as a job posting            |

The Greenhouse fixture is modeled on publicly visible Greenhouse board markup. Live
markup can change; when it does, update the fixture from a real public posting and
keep the test expectations honest.
