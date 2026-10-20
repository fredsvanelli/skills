# Upstream mode

A `ui` runbook depends on an upstream API: the API its screens call. The upstream mode says how the runbook reaches it. Terms: `${CLAUDE_PLUGIN_ROOT}/CONTEXT.md`. Why the mock is a plugin server: `${CLAUDE_PLUGIN_ROOT}/docs/adr/0003-mocked-upstream-served-by-plugin-server.md`. Config keys: `config.md`, "Upstream".

## Modes

A `ui` runbook runs in one of two modes:

- `live`: the real upstream API, holding test data.
- `mocked`: fixed responses, served by the upstream server in place of the API.

The config holds the project default in `upstream.mode`. A runbook overrides it with `upstream: live|mocked` in its frontmatter, written only when it differs from the default. There is no per-step mode. A config without `upstream` means `live`, and `upstream` in a `backend` stack is a config error.

Every browser mode (`guided`, `headless`, `headed`, `chrome`, `prompt`, `script`) works with both modes, and a script stays optional for both. Mode `test` is offered for a `ui` runbook only when its script has one test per step, the shape of a mocked script (see "Scripts"). A live script keeps one test with a `test.step` per step, so `test` is not offered for it, and the mode question says why.

Design comparison happens only in browser runs. A mocked runbook keeps its `design` references.

A mocked runbook proves what the screen shows and the request the screen sends. It never proves what the API saves. A step that would check persistence checks the request instead (method, URL, body), and persistence goes under "Not covered". Why a mocked runbook covers no endpoint: `${CLAUDE_PLUGIN_ROOT}/docs/adr/0004-mocked-runbooks-never-cover-endpoints.md`.

### Live runbooks

The upstream API runs locally from a sibling repo (`upstream.root` and `upstream.start`) or remotely (`upstream.baseUrl` only). Before the first step of a live runbook, `run` checks that `upstream.baseUrl` answers and shows `upstream.start` when it does not.

- A script creates its precondition data through the upstream API (Playwright `request`, `cy.request`) when the API has the endpoint, else through the upstream seed command. It never relies on data that already sits in the environment. Browser runs keep UI setup steps or `data.seedHint`.
- A script authenticates to the upstream API with the `accounts` of the role a precondition names. `upstream.tokenEnv` names a service token env var for an API without password login.
- Each run appends a unique suffix to the data it creates. Scripts read it from `RUNBOOKS_RUN_ID`. Expected quotes only the fixed part of a value, and Cleanup deletes through the API what the run created.
- Error scenarios of the upstream API (a 500, a timeout) cannot happen in a live runbook. They go in a second, mocked runbook named `<flow>-upstream-errors`.

### Changing a runbook's mode

The change goes through `update`.

- To `mocked`: record the fixtures, rewrite persistence steps as request checks, and list persistence under "Not covered".
- To `live`: delete the fixtures, restore the persistence steps, and move exact values into Preconditions with the run suffix.

`audit-runbooks` flags a hand-edited `upstream:` whose runbook content no longer fits its mode.

## Fixtures

A mocked runbook `<capability>.<flow>` keeps its fixtures in `<upstream.fixtures>/<capability>/<flow>/`. `upstream.fixtures` defaults to `<paths.runbooks>/_fixtures`. A fixture for one step goes in a folder named for the step, `<flow>/S03/`, and overrides the files in the runbook folder while that step is current. Any other subfolder is a problem.

One fixture is one `.json` file:

```json
{
  "request": { "method": "GET", "path": "/v1/invoices", "query": { "page": "1" } },
  "response": {
    "status": 200,
    "headers": { "content-type": "application/json" },
    "body": { "items": [] }
  },
  "source": "recorded 2026-10-20 from https://api.example.com"
}
```

| Key | Meaning |
|---|---|
| `request.method`, `request.path` | required. The path is the full path the app sends, including any prefix such as `/v1` |
| `request.query` | optional. A request matches when it carries every key named here with an equal value. Extra keys in the request (`_t=123`) and a different key order do not matter |
| `response.status` | required |
| `response.headers` | optional |
| `response.body` | optional. An object or array is sent as JSON. A string is sent as is, with `text/plain` unless `content-type` says otherwise. A `204`, or a missing body, sends no body |
| `source` | where the fixture came from (below) |

`source` has one of three forms: `recorded <date> from <baseUrl>`, `schema`, or `hand-written: <reason>`. `run` counts the fixtures that were not recorded and states the count in the report's Notes.

Which command touches fixtures:

- `create` writes them with the runbook, and `update` re-records them when steps change.
- `to-test` only reads them.
- `run <id> --record` records them from one live execution of the flow (see "Recording").
- When the live API does not answer, fixtures come from `upstream.schema`, else they are written by hand.

### Checking fixtures

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" fixtures <id> [--json]
```

The command loads the fixtures of a `ui` runbook, counts them by `source`, and lists problems: a file that is not valid JSON, a missing `request.method`, `request.path` or `response.status`, and a folder that is not a step folder. With `upstream.schema` set, it also checks each JSON response body against the operation in the OpenAPI 3 JSON file. A fixture with no matching operation or status is a problem too. Problems are findings, so the command exits 0 with them. It exits 2 only when the id or the config is unusable (an unknown id, a runbook that is not `ui`, a missing schema file).

When `upstream.schema` is set, `run` runs this check before the first step. A runbook with a problem is `blocked`, not `failed`, and `run` offers `/runbooks:to-test <id>` or `/runbooks:update <id>` to re-record. The loader also warns, without invalidating the runbook, when a mocked runbook has no script or no fixtures.

## Server

One dependency-free Node file, `scripts/upstream-server.mjs`, serves the upstream API. It listens on `127.0.0.1:<upstream.port>` (default `4010`). The app starts with the env var named in `upstream.urlEnv` (for example `NEXT_PUBLIC_API_URL`) set to the server's URL, so the server sees the requests of the browser and of the app's own server (SSR, route handlers, server actions).

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" upstream [--port n] [--mode mocked|live|record] [--runbook id] [--step Sxx]
```

The command reads the `upstream` block of the config. The flags override `upstream.port` and `upstream.mode`, and select the runbook and step at startup. It prints `runbooks-upstream listening on http://127.0.0.1:<port>` and stops on SIGINT or SIGTERM. When the port is taken, it exits 2 with a message that names the port and `upstream.port`.

The server answers in one of three modes, which a select call changes without a restart:

| Mode | Behavior |
|---|---|
| `mocked` | Serves the selected runbook's fixtures. A request that matches none gets a 501 that names the method, path, runbook and step. The server logs it in `unmatched`. The step that needed it becomes `blocked`, and `run` offers `/runbooks:update <id>` to record it. It answers CORS preflights, and its own `access-control-allow-origin` (the request's origin, else `*`) and `access-control-allow-credentials` replace the same headers in a fixture |
| `live` | Proxies every request to `upstream.baseUrl`, SSE as a stream and WebSocket through Node's `upgrade` event. The target's path prefix is not added: the app sends it already |
| `record` | Proxies like `live` and saves each response as a fixture (see "Recording") |

The `live` mode serves a project that has at least one mocked runbook, so a switch between live and mocked runbooks in one `run` is a control call and not an app restart. A project whose runbooks are all live never goes through the server. A proxied target that does not answer gives a 502.

Matching in `mocked` mode:

1. The method and the path (without query) must be equal.
2. Every query key the fixture names must be equal in the request.
3. Among the candidates, a fixture in the current step's folder wins over one in the runbook folder, then the fixture naming more query keys, then the lower file name.

### The copy in the project

When `tests.ui` exists, `setup` copies the server to `<tests.ui.dir>/runbooks-upstream.mjs` and writes the path in `upstream.serverFile`, so CI runs mocked scripts without the plugin. The copy carries the plugin version in its header comment and in `export const VERSION`. `list` and `coverage` warn when the copy is missing or from another version, `/runbooks:setup` refreshes the copy, and `/runbooks:upgrade` offers to run it. The copy takes its options from flags, which all take a value:

```
node <tests.ui.dir>/runbooks-upstream.mjs --fixtures <dir> [--port n] [--mode mocked|live|record] [--target <url>] [--redact a,b] [--runbook id] [--step Sxx]
```

`--fixtures` is required. `--port` defaults to `4010` and `--mode` to `mocked`.

## Control routes

The agent and the scripts steer the server through these routes. They sit under `/__runbooks/` and answer JSON. They verify nothing: a result is verified by what the browser shows.

```
curl -s -X POST http://127.0.0.1:<port>/__runbooks/select -H 'content-type: application/json' -d '{"runbook":"billing.list","mode":"mocked"}'
curl -s http://127.0.0.1:<port>/__runbooks/state
```

| Route | Does |
|---|---|
| `POST /__runbooks/select` | Takes a JSON object with any of `runbook`, `step` and `mode`, and changes only the keys it gets. A new `runbook` without `step` resets the step. `runbook` is `null` or an id `<capability>.<flow>`, `step` is `null` or `S<nn>`, and `mode` is `mocked`, `live` or `record`. Every select clears the request log. Answers `{ runbook, mode, step }` |
| `GET /__runbooks/state` | Answers `{ runbook, mode, step, requests, unmatched }` |

Three rules keep web pages away from these routes:

- A control call gets a 403 unless its `Host` header names `127.0.0.1`, `localhost` or `[::1]`, on any port. The app's own requests to the server are not checked.
- A select whose `content-type` is not `application/json` gets a 415. Playwright `request.post` with `data` and Cypress `cy.request` with an object body send that type.
- The control routes send no CORS headers, and a preflight to them gets a 404, so a page on another origin can neither read them nor send them JSON.

An invalid body, or a `runbook` or `step` that is not an id, gets a 400 and changes nothing. Any other control route gets a 404.

`requests` lists every request the app made since the last select, in all three modes, as `{ method, path, query, body, step, status }`. An agent checks the request a mocked screen sent by reading it there. `unmatched` lists the mocked requests that had no fixture, as `{ method, path, step }`.

The agent selects the runbook and the step before each step, and scripts do it in `beforeEach`. The scripts get `RUNBOOKS_UPSTREAM_URL`, the server origin, to make these calls.

## Recording

`run <id> --record` runs the flow once against the live API with the server in `record` mode. The server proxies each request, asks the API for `accept-encoding: identity` so stored bodies are plain, and saves each response as a fixture of the selected runbook and step.

Rules for what is saved:

- Each file is named from the method, the path and a hash of the query, and holds `request`, `response` and `source` (`recorded <date> from <upstream.baseUrl origin>`).
- `set-cookie`, `authorization`, `cookie` and every header in `upstream.redactHeaders` are dropped, whatever the case. Transport headers (`content-length`, `content-encoding`, `transfer-encoding`, `connection`, `keep-alive`) are dropped too, and so are `vary` and every `access-control-*` header, because the server sends its own CORS headers in `mocked` mode.
- A request that already has an equal fixture writes nothing. A response that differs is saved in the current step's folder.
- A `text/event-stream` response streams to the app and is not recorded.
- With no runbook selected, nothing is written.
- `request.query` holds the full query, so remove volatile keys such as a cache-buster (`_t`) from the file by hand. Otherwise the fixture never matches again.
- A fixture that cannot be written is logged, and the server keeps serving.

Rules for the agent:

- Record only requests over the data the runbook's Preconditions created. Never record a flow over data that already sits in the environment.
- Show the diff of the fixtures before any commit.

## Scripts

The script of a mocked runbook has one test per step, named `S01 <title>`. Each test selects the runbook and the step on the server, then navigates to the step's start page. `Parents:` still decide `blocked-by-parent`, which `runbooks.mjs junit` applies afterwards. With viewports, there is one test per step and viewport, named `S01 <title> @ <viewport>`, and `junit` gives one state per step and viewport. This shape is what makes mode `test` available.

```ts
test.beforeEach(async ({ request }, info) => {
  const step = /^(S\d+)/.exec(info.title)![1]
  await request.post(`${process.env.RUNBOOKS_UPSTREAM_URL}/__runbooks/select`, {
    data: { runbook: 'billing.issue-invoice', step, mode: 'mocked' },
  })
})

test.afterAll(async ({ playwright }) => {
  const api = await playwright.request.newContext()
  await api.post(`${process.env.RUNBOOKS_UPSTREAM_URL}/__runbooks/select`, {
    data: { runbook: null, mode: 'live' },
  })
  await api.dispose()
})
```

The server holds one state for every client: one runbook, one step and one mode. So every test suite whose app points at the server runs with one worker, in CI too: Playwright `workers: 1` for that project or job, while Cypress already runs specs one at a time. With two workers, one worker's select would change the responses the other worker's app gets. When `upstream.baseUrl` is set, the copy starts with `--mode live --target <upstream.baseUrl>`, so a test that never selects reaches the live API through it. A mocked script posts `{ runbook, mode: 'mocked', step }` in `beforeEach` and `{ runbook: null, mode: 'live' }` in `afterAll`, which hands the server back to those tests. A live `ui` script posts nothing.

A script keeps the design comparison out: only a browser run compares a screen with its design. A mocked runbook without a script is allowed, but then no automated run checks its fixtures, and only the schema check or `list --affected` notices an API change. `setup` warns about this.
