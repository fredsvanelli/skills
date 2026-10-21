# Upstream mode for ui runbooks

Decisions from the grilling session of 2026-10-20. Terms are defined in `runbooks/CONTEXT.md` (Upstream API, Upstream mode, Script, Covered, Design reference). Why the mock is a plugin server: `runbooks/docs/adr/0003-mocked-upstream-served-by-plugin-server.md`. Why mocked runbooks cover no endpoint: `runbooks/docs/adr/0004-mocked-runbooks-never-cover-endpoints.md`.

## Modes

- A `ui` runbook reaches its upstream API in one of two modes: `live` (the real API holding test data) or `mocked` (fixed responses served in its place).
- The config holds the project default in `upstream.mode`. A runbook overrides it with `upstream: live|mocked` in its frontmatter, written only when it differs from the default. No per-step mode.
- A config without `upstream` behaves as `live`, which is today's behavior. `upgrade` asks nothing.
- `upstream` exists only in a stack with `ui`. In a `backend` stack it is a config error.

## Where runs happen

- Every browser mode stays available for every `ui` runbook, live or mocked. A `ui` runbook's script stays optional, mocked included.
- A `mocked` runbook without a script is allowed. `setup` warns that no automated run checks its fixtures and that only the schema check or `list --affected` notices an API change. The loader warns (without invalidating) for each mocked runbook without a script.
- Mode `test` becomes available for a `ui` runbook whose script has one test per step (the mocked script shape below). Live scripts keep one test with `test.step` per step, and `test` is not offered for them; the mode question says why.
- Design comparison happens only in browser runs, never in scripts. Mocked runbooks keep their `design` references.

## The upstream server (ADR 0003)

- One dependency-free Node file, `scripts/upstream-server.mjs`, started by `runbooks.mjs upstream`. It listens on `127.0.0.1:<upstream.port>` (default 4010).
- The app starts with the env var named in `upstream.urlEnv` (for example `NEXT_PUBLIC_API_URL`) set to the server's URL. This catches requests made by the browser and by the app's server (SSR, route handlers, server actions).
- Control routes under `/__runbooks/`: select the current runbook, its mode and its step; read the log of requests since the last selection.
- `mocked`: serves the selected runbook's fixtures by method, path and query, with a per-step folder overriding the runbook folder. A request with no fixture gets a 501 that names it and is logged; the step that needed it becomes `blocked`, and `run` offers `/runbooks:update <id>` to record it. Answers CORS preflights.
- `live`: proxies everything to `upstream.baseUrl`, SSE as a stream and WebSocket through Node's `upgrade` event. Used only when the project has at least one mocked runbook; a project that is all live never goes through it.
- `record`: proxies like `live` and saves each response as a fixture of the selected runbook and step.
- Recorded fixtures drop `Set-Cookie`, `Authorization`, `Cookie` and every header in `upstream.redactHeaders`. Only requests over the data the runbook's Preconditions created are recorded. The diff of the fixtures is shown before any commit.
- `setup` copies the server into the project at `<tests.ui.dir>/runbooks-upstream.mjs` when `tests.ui` exists, so CI runs mocked scripts without the plugin. The copy carries the plugin version in a comment; a warning appears when it differs from the installed plugin.

## Fixtures

- Location: `<upstream.fixtures>/<capability>/<flow>/`, default `upstream.fixtures` = `<paths.runbooks>/_fixtures`. Step overrides go in `<flow>/S03/`.
- `create` writes them along with the runbook, `update` re-records when steps change, `to-test` only reads them.
- Recording needs one live execution: `run <id> --record`. When the live API does not answer, fixtures come from `upstream.schema`, else by hand. Each fixture has `source`: `recorded <date> from <baseUrl>`, `schema`, or `hand-written: <reason>`. The run report counts the fixtures that were not recorded.
- With `upstream.schema`, `run` validates the runbook's fixtures before the first step. A fixture that does not match makes the runbook `blocked` (not `failed`) and `run` offers `/runbooks:to-test <id>` or `/runbooks:update <id>` to re-record.

## Runbook content

- A mocked runbook proves what the screen shows and the request it sends. A step that would check persistence checks the request (method, URL, body) instead, and persistence goes under "Not covered".
- Error scenarios of the upstream API (500, timeout) cannot happen in a live runbook. `create` proposes a second runbook, mocked, holding only those scenarios (`<flow>-upstream-errors`), when there is at least one.
- Changing a runbook's mode goes through `update`: to `mocked` it records fixtures, rewrites persistence steps as request checks and lists persistence under "Not covered"; to `live` it deletes the fixtures, restores persistence steps and moves exact values into Preconditions with the run suffix. `audit-runbooks` flags a hand-edited `upstream:` that left the content incoherent.

## Live mode

- The upstream API runs locally from a sibling repo (`upstream.root`, `upstream.start`) or remotely (`upstream.baseUrl` only). `setup` recommends local when it finds the sibling repo. In a `fullstack` stack whose `tests.api.root` is that repo, `upstream.root` takes the same value without a question.
- Scripts create precondition data through the upstream API (Playwright `request`, `cy.request`) when it has the endpoint, else through the upstream seed command. Never through data that already sits in the environment. Browser runs keep UI setup steps or `data.seedHint`.
- Scripts authenticate to the upstream API with the `accounts` of the role a precondition names; `upstream.tokenEnv` names a service token env var for APIs without password login.
- Each run appends a unique suffix (the run id, `RUNBOOKS_RUN_ID` in scripts) to the data it creates. Expected quotes the fixed part, and Cleanup deletes through the API what the run created.
- `run` checks that `upstream.baseUrl` answers before the first step of a live runbook and shows `upstream.start` when it does not.

## Coverage (ADR 0004)

- A mocked runbook covers only its `ui-route` entries, whatever the stack. It keeps its endpoints in `covers.entries` for `list --affected`.
- An endpoint cited only by mocked runbooks stays uncovered and shows as "cited, not covered (mocked)" in the coverage Markdown and `coverage.html`.
- `setup` says so when it recommends `mocked`.

## Scripts of mocked runbooks

- One test per step, named `S01 <title>`, each registering its state on the server (select runbook and step) and navigating to the step's start. `Parents:` still decide `blocked-by-parent`.
- With viewports, one test per step and viewport, named `S01 <title> @ <viewport>`. `runbooks.mjs junit` gives one state per step and viewport.

## Setup

- Asks the upstream mode when the stack has `ui` and the upstream API is not served by the app's own process (sibling repo, remote URL, third party). Otherwise writes nothing, which means `live`.
- Recommends `mocked` when the project's tests already intercept requests (`page.route`, `cy.intercept`, MSW), `live` when the sibling repo starts locally, `mocked` when the API is only remote or third party.
- Asks the test framework before the upstream mode.

## Settings

A new `upstream` group with every `upstream.*` key.
