# API runbooks run through their script, not through the agent

A `ui` runbook is verified by the agent in the browser, and the skillset never confirms a result through a direct HTTP call. An `api` runbook is the opposite: its `scripts` file (Jest, Vitest, PHPUnit, Pest, ...) is required and is the only executor. `run` invokes the project's test command and maps the results back to steps through JUnit XML, matching each test by its `Sxx` prefix. The plugin resolves `blocked-by-parent` itself from the runbook's `Parents:`, so no framework needs `@depends` or chained skips. We chose this over letting the agent call endpoints by hand. Tests are repeatable, they run in the project's isolated test environment (where side effects can be checked through fakes or framework database assertions), and they keep the agent's own "no database, no SQL" rule intact. The runbook stays the source of truth: when a script and its runbook disagree, the script changes unless the user says the runbook is wrong, and no assertion is loosened to make the app pass.

## Considered Options

- The agent calls the API directly (curl or fetch) and judges the response. Rejected: it is not repeatable, it cannot see side effects without touching the database, and it would break the browser-only rule in an ad hoc way.
- One state for the whole runbook (the file passes or fails). Rejected: it loses step granularity and empties the dependency tree of meaning.
