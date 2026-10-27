# Upstream mode

A `ui` runbook depends on an upstream API: the API its screens call. The upstream mode says how the runbook reaches it. Terms: `${CLAUDE_PLUGIN_ROOT}/CONTEXT.md`. Why the mock is a plugin server: `${CLAUDE_PLUGIN_ROOT}/docs/adr/0003-mocked-upstream-served-by-plugin-server.md`. Config keys: `config.md`, "Upstream".

## Modes

A `ui` runbook runs in one of two modes:

- `live`: the real upstream API, holding test data.
- `mocked`: fixed responses, served by the upstream server in place of the API.

The config holds the project default in `upstream.mode`. A runbook overrides it with `upstream: live|mocked` in its frontmatter, written only when it differs from the default. There is no per-step mode. A config without `upstream` means `live`, and `upstream` in a `backend` stack is a config error.

Every browser mode (`guided`, `headless`, `headed`, `chrome`, `prompt`, `script`) works with both modes, and a script stays optional for both. Mode `test` is offered for a `ui` runbook only when its script has one test per step, the shape of a mocked script (see "Scripts"). A live script keeps one test with a `test.step` per step (with role tracking on, one such test per role and viewport), so `test` is not offered for it, and the mode question says why.

Design comparison happens only in browser runs. A mocked runbook keeps its `design` references.

A mocked runbook proves what the screen shows and the request the screen sends. It never proves what the API saves. A step that would check persistence checks the request instead (method, URL, body), and persistence goes under "Not covered". Why a mocked runbook covers no endpoint: `${CLAUDE_PLUGIN_ROOT}/docs/adr/0004-mocked-runbooks-never-cover-endpoints.md`.

### Live runbooks

The upstream API answers at `upstream.baseUrl`, started locally by its own repository or deployed. Before the first step of a live runbook, `run` checks that `upstream.baseUrl` answers and shows `upstream.start` when it does not.

- A script creates its precondition data through the upstream API (Playwright `request`, `cy.request`) when the API has the endpoint, else through the upstream seed command. It never relies on data that already sits in the environment. Browser runs keep UI setup steps or `data.seedHint`.
- A script authenticates to the upstream API with the `accounts` of the role a precondition names. `upstream.tokenEnv` names a service token env var for an API without password login.
- Each run appends a unique suffix to the data it creates. Scripts read it from `RUNBOOKS_RUN_ID`. Expected quotes only the fixed part of a value, and Cleanup deletes through the API what the run created.
- Error scenarios of the upstream API (a 500, a timeout) cannot happen in a live runbook. They go in a second, mocked runbook named `<flow>-upstream-errors`.

### Another repository

When the upstream API lives in another repository, that repository has its own runbooks install, and neither reads the other's files (`${CLAUDE_PLUGIN_ROOT}/docs/adr/0005-upstream-api-in-another-repo-is-a-contract.md`):

- Its endpoints are not entries of this project. A `ui` runbook lists the operations its screens reach in `calls`, as `METHOD /path` with `{param}` segments (`format.md`, the `calls` key). `calls` never counts as coverage and never makes an orphan; the API's own install covers its endpoints through `api` runbooks.
- The contract is the OpenAPI 3 JSON document the API publishes, kept in this repository at `upstream.schema` (`docs/runbooks/_contract/openapi.json` by default). The plugin fetches nothing: a job in this project's CI brings each new version in, from the API's release, artifact or package, and opens a pull request with it. In that pull request, `runbooks.mjs contract --strict` fails on what the new version breaks, and `list --affected` names the runbooks it reaches (see "Contract").
- `upstream.start` is a hint that names the API's repository and its command. No key points to a folder next to this project, because CI checks out this repository alone.

A project set up before this rule may still read the API through an `entries` source with a `root` outside the project. The loader warns about it, and `/runbooks:settings sources` moves its ids to `calls` with `runbooks.mjs move-to-calls`.

### Changing a runbook's mode

The change goes through `update`.

- To `mocked`: record the fixtures, rewrite persistence steps as request checks, and list persistence under "Not covered".
- To `live`: delete the fixtures, restore the persistence steps, and move exact values into Preconditions with the run suffix.

`audit` flags a hand-edited `upstream:` whose runbook content no longer fits its mode.

## Fixtures

A mocked runbook `<capability>.<flow>` keeps its fixtures in `<upstream.fixtures>/<capability>/<flow>/`. `upstream.fixtures` defaults to `<paths.runbooks>/_fixtures`. A fixture for one step goes in a folder named for the step, `<flow>/S03/`, and overrides the files in the runbook folder while that step is current. A `@<role>` folder is a role layer ("Role layer" below), and a `+<case>` folder a case layer ("Case layer" below). Any other subfolder is a problem.

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
| `request.operationName` | optional, a non-empty string. The GraphQL operation the fixture answers ("GraphQL operations" below). A fixture without it answers any body |
| `request.variables` | optional, a JSON object, only with `request.operationName`. The values the GraphQL request's `variables` must carry. A request may carry more |
| `request.body` | optional, an object or array, only without `request.operationName`. The value the request's JSON body must carry ("Matching in `mocked` mode", rule 4) |
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

### GraphQL operations

A GraphQL app sends every operation as `POST /graphql`, so method and path cannot tell `Client` from `GroupsByPartyId`. A fixture names the operation it answers in `request.operationName`, and a runbook holds one fixture per operation the page sends. Why the match stays on the request plus this one name: `${CLAUDE_PLUGIN_ROOT}/docs/adr/0008-graphql-fixtures-match-on-the-operation-name.md`.

```json
{
  "request": { "method": "POST", "path": "/graphql", "operationName": "GroupsByPartyId" },
  "response": { "status": 200, "headers": { "content-type": "application/json" }, "body": { "data": { "groupsByPartyId": [] } } },
  "source": "hand-written: client with no groups"
}
```

The server reads `operationName` from a JSON request body, one whose `content-type` contains `json`. A fixture with `operationName` answers only a request whose body names that operation. A request with no JSON body, or with a body that names no operation, gets only fixtures without `operationName`. A GraphQL query sent with `GET` carries `operationName` in its query string, so its fixture uses `request.query` instead.

One operation can go out several times with different variables, such as a page whose tabs all send `SearchClients`. A fixture names the variables it answers in `request.variables`, and a fixture without `variables` answers any variables:

```json
{
  "request": { "method": "POST", "path": "/graphql", "operationName": "SearchClients", "variables": { "type": "clients" } },
  "response": { "status": 200, "body": { "data": { "searchClients": [] } } },
  "source": "hand-written: clients tab"
}
```

In a batch, each item is matched with its own `operationName` and `variables`. Why a partial object is not a query language: `${CLAUDE_PLUGIN_ROOT}/docs/adr/0009-fixtures-match-on-a-partial-payload.md`.

A body that is a JSON array is a batch. It is answered item by item when at least one item has a fixture with `operationName`, and only those fixtures answer items:

- An item without a fixture makes the whole batch a 501. Its body lists the missing operations in `operationNames`, in batch order, with `null` for an item that names none, and each one goes in `unmatched`.
- Otherwise, the first item whose fixture has a status of 300 or more answers the whole batch with that fixture as is. A GraphQL server fails a whole HTTP request or none of it, and Apollo's `BatchHttpLink` rejects every operation of the batch on such a status. A mocked runbook simulates one failing operation with one fixture, `status: 500` and that `operationName`.
- Otherwise, the batch gets a 200 with the items' bodies in batch order. Its headers merge the items' fixture headers, the first item winning a name both set, and `content-type` is `application/json`. A fixture whose body is a string, or that has no body, cannot be an item of an array, so the batch gets a 500 that names its file.

A batch with no item that has such a fixture matches as one request, by method, path and query, as before. So does an empty array and an array of objects that name no operation, such as the body of a REST bulk endpoint.

### Role layer

With role tracking on (`config.md`, Roles), a role has its own responses. A folder named `@<role>` holds them, at two levels:

```
_fixtures/billing/list-invoices/
  invoices.json
  @editor/
    me.json
  S02/
    invoices.json
    @anonymous/
      invoices.json
```

- `<capability>/<flow>/@<role>/` holds a role's responses for the whole runbook: its session (`GET /me` and the like) and its 403s.
- `<capability>/<flow>/S02/@<role>/` holds them for one step.

Lookup goes from the most specific folder to the least: step and role, then step, then role, then runbook. A fixture in a role folder answers only while that role is selected. Among the candidates, the order above decides before the rule on fields. The role names are registered roles, `anonymous` included.

`runbooks.mjs fixtures` accepts `@<role>` folders. It reports a folder whose name is not a role name, one whose role the registry does not have, and any role folder when role tracking is off.

### Case layer

A runbook with cases (`format.md`, "Contexts and cases") gets the record of each case from its fixtures: the client with its `vip` flag and its team, for example. A folder named `+<case>` holds the responses of that case, at four levels:

```
_fixtures/clients/edit-client/
  client.json
  +vip-team/
    client.json
  @manager/
    me.json
    +vip-outside/
      client.json
  S02/
    +regular/
      client.json
    @manager/
      +vip-outside/
        client.json
```

- `<capability>/<flow>/+<case>/` and `<capability>/<flow>/S02/+<case>/` hold a case's responses for every role, for the whole runbook or for one step.
- `<capability>/<flow>/@<role>/+<case>/` and `<capability>/<flow>/S02/@<role>/+<case>/` hold them for one role in that case.

Lookup goes from the most specific folder to the least: step, role and case; step and role; step and case; step; role and case; role; case; runbook. So `S02/@manager/+vip-outside/` comes first, then `S02/@manager/`, then `S02/+vip-outside/`. A fixture in a case folder answers only while that case is selected. A case with no folder of its own gets the role's and the runbook's responses, not a 501.

`runbooks.mjs fixtures` accepts `+<case>` folders. It reports `<folder>: not a case folder` for a name that is not a case name, `<folder>: case <name> is not one of the runbook's cases`, and `<folder>: case folders need a context` for any case folder of a runbook with no context.

### Checking fixtures

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" fixtures <id> [--json]
```

The command loads the fixtures of a `ui` runbook, counts them by `source`, and lists problems: a file that is not valid JSON, a missing `request.method`, `request.path` or `response.status`, a `request.operationName` that is not a non-empty string, a `request.variables` that is not an object or has no `request.operationName`, a `request.body` beside a `request.operationName`, a `request.body` that is not an object or array, and a folder that is not a step folder. With `upstream.schema` set, it also checks each JSON response body against the operation in the OpenAPI 3 JSON file. A fixture with no matching operation or status is a problem too. A fixture with `request.operationName` answers a GraphQL operation, which an OpenAPI document does not describe, so it skips this check. Problems are findings, so the command exits 0 with them. It exits 2 only when the id or the config is unusable (an unknown id, a runbook that is not `ui`, a missing schema file).

When `upstream.schema` is set, `run` runs this check before the first step. A runbook with a problem is `blocked`, not `failed`, and `run` offers `/runbooks:to-test <id>` or `/runbooks:update <id>` to re-record. The loader also warns, without invalidating the runbook, when a mocked runbook has no script or no fixtures.

## Server

One dependency-free Node file, `scripts/upstream-server.mjs`, serves the upstream API. It listens on `127.0.0.1:<upstream.port>` (default `4010`). The app starts with the env var named in `upstream.urlEnv` (for example `NEXT_PUBLIC_API_URL`) set to the server's URL, so the server sees the requests of the browser and of the app's own server (SSR, route handlers, server actions).

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" upstream [--port n] [--mode mocked|live|record] [--runbook id] [--role name] [--case name] [--step Sxx]
```

The command reads the `upstream` block of the config. The flags override `upstream.port` and `upstream.mode`, and select the runbook, role, case and step at startup. It prints `runbooks-upstream listening on http://127.0.0.1:<port>` and stops on SIGINT or SIGTERM. When the port is taken, it exits 2 with a message that names the port and `upstream.port`.

The server answers in one of three modes, which a select call changes without a restart:

| Mode | Behavior |
|---|---|
| `mocked` | Serves the selected runbook's fixtures. A request that matches none gets a 501 that names the method, path, runbook and step, and the GraphQL operation when the body names one, plus the request's `variables` or `body` with the redacted keys dropped. The server logs it in `unmatched`. The step that needed it becomes `blocked`, and `run` offers `/runbooks:update <id>` to record it. It answers CORS preflights, and its own `access-control-allow-origin` (the request's origin, else `*`) and `access-control-allow-credentials` replace the same headers in a fixture |
| `live` | Proxies every request to `upstream.baseUrl`, SSE as a stream and WebSocket through Node's `upgrade` event. The target's path prefix is not added: the app sends it already |
| `record` | Proxies like `live` and saves each response as a fixture (see "Recording") |

The `live` mode serves a project that has at least one mocked runbook, so a switch between live and mocked runbooks in one `run` is a control call and not an app restart. A project whose runbooks are all live never goes through the server. A proxied target that does not answer gives a 502.

Matching in `mocked` mode:

1. The method and the path (without query) must be equal.
2. Every query key the fixture names must be equal in the request.
3. A fixture with `request.operationName` must name the operation of the request body ("GraphQL operations").
4. A fixture with `request.variables` needs the request's `variables` to carry it, and a fixture with `request.body` needs a JSON request body that carries it. An object in the fixture matches an object in the request when every key of the fixture is in the request and its value matches, at any depth. An array or a scalar, `null` included, matches only an equal value. A request that leaves out a key the fixture sets to `null` does not match. A request with no JSON body matches no fixture with `body`.
5. Among the candidates, a fixture in the current step's folder wins over one in the runbook folder (with role and case folders, the order of "Case layer"), then the fixture naming the operation, then the fixture naming more fields (query keys plus payload leaves, where a leaf is a scalar, `null` or an array), then the lower file name. So a fixture without `operationName` in `S02/` still wins over one with it in the runbook folder while `S02` is current.

### The copy in the project

When `tests.ui` exists, `setup` copies the server to `<tests.ui.dir>/runbooks-upstream.mjs` and writes the path in `upstream.serverFile`, so CI runs mocked scripts without the plugin. When `tests.ui.root` points to a UI tests repository, the copy goes there, to `<tests.ui.root>/<tests.ui.dir>/runbooks-upstream.mjs`, and the fixtures stay in this one: that repository's CI checks out this one to pass `--fixtures` (`${CLAUDE_PLUGIN_ROOT}/docs/adr/0007-ui-tests-may-live-in-another-repo.md`). `list` and `coverage` do not warn about the copy while that repository is not cloned. The copy carries the plugin version in its header comment and in `export const VERSION`. `list` and `coverage` warn when the copy is missing or from another version, `/runbooks:setup` refreshes the copy, and `/runbooks:upgrade` offers to run it. The copy takes its options from flags, which all take a value:

```
node <tests.ui.dir>/runbooks-upstream.mjs --fixtures <dir> [--port n] [--mode mocked|live|record] [--target <url>] [--redact a,b] [--redact-body a,b] [--runbook id] [--role name] [--case name] [--step Sxx]
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
| `POST /__runbooks/select` | Takes a JSON object with any of `runbook`, `role`, `case`, `step` and `mode`, and changes only the keys it gets. A new `runbook` resets the role, the case and the step it does not name. A new `role` resets the case and the step it does not name. A new `case` without `step` resets the step. `runbook` is `null` or an id `<capability>.<flow>`, `role` is `null` or a role name, `case` is `null` or a case name, `step` is `null` or `S<nn>`, and `mode` is `mocked`, `live` or `record`. Every select clears the request log. Answers `{ runbook, mode, role, case, step }` |
| `GET /__runbooks/state` | Answers `{ runbook, mode, role, case, step, requests, unmatched }` |

Three rules keep web pages away from these routes:

- A control call gets a 403 unless its `Host` header names `127.0.0.1`, `localhost` or `[::1]`, on any port. The app's own requests to the server are not checked.
- A select whose `content-type` is not `application/json` gets a 415. Playwright `request.post` with `data` and Cypress `cy.request` with an object body send that type.
- The control routes send no CORS headers, and a preflight to them gets a 404, so a page on another origin can neither read them nor send them JSON.

An invalid body, or a `runbook`, `role`, `case` or `step` that is not a valid name, gets a 400 and changes nothing. Any other control route gets a 404.

`requests` lists every request the app made since the last select, in all three modes, as `{ method, path, query, body, step, status }`. A request body there drops the same keys as the 501 does. An agent checks the request a mocked screen sent by reading it there. `unmatched` lists the mocked requests that had no fixture, as `{ method, path, step }`, with `operationName` when the body names a GraphQL operation. The 501 body and the entry also carry the request's payload with the redacted keys dropped: `variables` for a named operation that sends them, `body` for another JSON object or array body. The agent sees which fixture to write. A batch adds one entry per item without a fixture, and `operationName` is `null` for an item that names none. The 501 body of a batch adds `variables` only when some missing item has variables, as an array in the order of `operationNames` with `null` for an item without. A step that checks a GraphQL request finds it in `requests` by the `operationName` in its `body`, or in an item of the `body` of a batch.

The agent selects the runbook, the role, the case and the step before each step, and scripts do it in `beforeEach`. The scripts get `RUNBOOKS_UPSTREAM_URL`, the server origin, to make these calls.

## Recording

`run <id> --record` runs the flow once against the live API with the server in `record` mode. The server proxies each request, asks the API for `accept-encoding: identity` so stored bodies are plain, and saves each response as a fixture of the selected runbook and step.

Rules for what is saved:

- With a role selected, the file goes in that role's folder (`@<role>/`) inside the folder it would use otherwise, the runbook's or the current step's. Without a role, it goes in the runbook's or the step's folder. With a case selected, it goes in the case's folder (`+<case>/`) inside that one, so `@viewer/+vip-team/` with both. A run records each role's pass, and each case's pass, under its own folder.
- Each file is named from the method, the path and a hash of the query, and holds `request`, `response` and `source` (`recorded <date> from <upstream.baseUrl origin>`).
- When the request body names a GraphQL operation, `request.operationName` holds it and the file name carries it, as `post--graphql-GroupsByPartyId.json`, so two operations never share a file. Only a fixture naming the same operation counts as the one the server would serve, so an operation with none goes in the runbook's folder even while a step is current.
- A batch that answers below 300 with an array of one result per item is saved item by item: each item that names an operation gets its own fixture with its result and the batch's headers. An item that names none is logged and not saved. A batch that answers 300 or more, or with anything but such an array, is logged and nothing of it is saved, because the server cannot tell which operation failed. Write that fixture by hand. An array body that names no operation is saved as one request, as before.
- A named operation with non-empty `variables` is saved with them in `request.variables`. A JSON object or array body that names no operation is saved with `request.body`. The server first drops the keys that `password`, `token`, `secret` and `upstream.redactBodyKeys` name (`config.md`, "Upstream"), so no secret reaches a fixture. A payload that is empty after redaction, or an empty object body, is not saved.
- A body whose `query` is a string starting with `{`, `query`, `mutation`, `subscription` or `fragment` is an anonymous GraphQL operation and is saved without `body`. A REST body such as `{"query":"foo"}` is saved with its body.
- A saved payload adds a hash of it to the file name after the query hash, as `post--graphql-SearchClients-1a2b3c4d.json`. The hash covers the payload after redaction, with keys sorted, so key order and a dropped secret do not change the name.
- A payload array is saved whole or not at all. Arrays match only when equal, so a redacted array would never match its own request. When redaction removes a key inside an array, the server drops the object key that holds the array, and for a top-level array body it saves no `body`. The fixture then matches more requests. Two calls of one operation with different variables write two files.
- Only a fixture that has `variables` or `body` counts as the one the server would serve for a request with a payload. When only an older fixture without a payload exists, the payload fixture goes in the runbook's folder, even if the old fixture returns the same response. The exception is an older fixture without a payload that answers in the current step, from that step's folder: the payload fixture then goes in the same step folder, because the older one would win on the step layer. Delete the older fixture once the payload fixtures replace it.
- When two calls send the same payload and get different results with no step current, the second result overwrites the first, and the server logs `overwrote <file> with a different response`.
- A value that changes on every run, such as a timestamp or a client-generated id, makes the fixture stop matching, and the next mocked run gets a 501 for it. Remove volatile payload keys from the recorded files by hand, as for a cache-buster in the query.
- `set-cookie`, `authorization`, `cookie` and every header in `upstream.redactHeaders` are dropped, whatever the case. Transport headers (`content-length`, `content-encoding`, `transfer-encoding`, `connection`, `keep-alive`) are dropped too, and so are `vary` and every `access-control-*` header, because the server sends its own CORS headers in `mocked` mode.
- When a fixture the server would serve for the selected role and case is equal to the response, the server writes nothing. That fixture can be in any folder of the lookup order. The server saves a response that differs in the current step's folder.
- A `text/event-stream` response streams to the app and is not recorded.
- With no runbook selected, nothing is written.
- `request.query` holds the full query, so remove volatile keys such as a cache-buster (`_t`) from the file by hand. Otherwise the fixture never matches again.
- A fixture that cannot be written is logged, and the server keeps serving.

Rules for the agent:

- Record only requests over the data the runbook's Preconditions created. Never record a flow over data that already sits in the environment.
- Show the diff of the fixtures before any commit.

## Scripts

The script of a mocked runbook has one test per step, named `S01 <title>`. Each test selects the runbook and the step on the server, then navigates to the step's start page. `Parents:` still decide `blocked-by-parent`, which `runbooks.mjs junit` applies afterwards. With viewports, there is one test per step and viewport, named `S01 <title> @ <viewport>`, and `junit` gives one state per step and viewport. With role tracking on, there is one test per step, role and viewport, named `S01 <title> as <role> @ <viewport>`, and `junit` gives one state per step, role and viewport. With cases, the case follows the role, `S01 <title> as <role> in <case> @ <viewport>`, and a role that runs once has no `in <case>` part. This shape is what makes mode `test` available.

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

The server holds one state for every client: one runbook, role, case, step and mode. So every test suite whose app points at the server runs with one worker, in CI too: Playwright `workers: 1` for that project or job, while Cypress already runs specs one at a time. With two workers, one worker's select would change the responses the other worker's app gets. When `upstream.baseUrl` is set, the copy starts with `--mode live --target <upstream.baseUrl>`, so a test that never selects reaches the live API through it. A mocked script posts `{ runbook, mode: 'mocked', step }` in `beforeEach` (`{ runbook, mode: 'mocked', role, step }` with role tracking on, the role being the one the test is named for, and `{ runbook, mode: 'mocked', role, case, step }` with cases, where a role that runs once selects its `dataCase` from `runbooks.mjs passes <id>`, the first case of `cases`) and `{ runbook: null, mode: 'live' }` in `afterAll`, which hands the server back to those tests. A live `ui` script posts nothing.

A script keeps the design comparison out: only a browser run compares a screen with its design. A mocked runbook without a script is allowed, but then no automated run checks its fixtures, and only the schema check or `list --affected` notices an API change. `setup` warns about this.

## Contract

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" contract [--strict] [--json]
```

The command checks every `ui` runbook that reaches the upstream API: the ones with `calls`, and the `mocked` ones, whose fixtures answer for it. `deprecated` runbooks are left out. Each finding names the runbook and its kind:

| Kind | Finding |
|---|---|
| `call` | a call matches no operation of `upstream.schema`. Parameter names do not matter (`{id}` matches `{quoteId}`), and the server path of the document's first `servers` entry may lead the call (`/v1/quotes`) |
| `fixture` | a fixture of a mocked runbook requests what none of its `calls`, and none of its `covers.entries`, names. A monorepo keeps its own endpoints in `covers.entries` (`${CLAUDE_PLUGIN_ROOT}/docs/adr/0004-mocked-runbooks-never-cover-endpoints.md`) |
| `fixture` | a fixture the schema rejects, as `fixtures <id>` reports it (`Fixtures`, "Checking fixtures"), or a fixture file that does not load. A fixture with `request.operationName` is not checked against the schema |

Without `upstream.schema`, only the fixtures are checked against the calls, and the report says so. A mocked runbook over a GraphQL API lists `POST /graphql` in `calls`. When `upstream.schema` is an OpenAPI file without that path, the call is a `call` finding. Findings exit 0; with `--strict` they exit 1, so a CI job can fail on them. The command exits 2 when the config has no `upstream` block or the schema file is missing or not JSON.

`list --affected` reads the same file. When `upstream.schema` is among the changed files, it compares the version at the merge base with the working tree, operation by operation, with `$ref`s resolved and the path item's parameters merged in. Prose (`description`, `summary`, `title`, examples, tags) and `x-` keys change nothing. A runbook whose `calls` name an operation that was added, changed or removed is affected, with the reason `upstream schema: <METHOD /path> changed` (or `added`, `removed`). A schema that did not exist at the base gives no reason, because there is nothing to compare.

In CI, the plugin is not installed. A job that runs the contract checks out the plugin's repository, pinned to the commit of the version the project uses, and runs `node <checkout>/runbooks/scripts/runbooks.mjs contract --strict` from the project root. It runs in the pull request that brings in a new version of the schema, and in every pull request that changes fixtures or calls. The plugin does not write that job: CI is the project's (`${CLAUDE_PLUGIN_ROOT}/commands/to-test.md`, step 8).
