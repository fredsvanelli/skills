# Upstream Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a `ui` runbook reach its upstream API either `live` or `mocked`, with a plugin server that serves fixtures, proxies and records, and with coverage, JUnit mapping and every command aware of the mode.

**Architecture:** The config gains an `upstream` block and runbooks an `upstream:` override, both validated in `scripts/lib`. A self-contained server (`scripts/upstream-server.mjs`, Node built-ins only, so `setup` can copy it into a project) serves fixtures, proxies to the live API and records; `runbooks.mjs upstream` starts it from the config and `runbooks.mjs fixtures` checks fixtures against an OpenAPI JSON schema. The commands are Markdown instructions, edited last, once the scripts they call exist.

**Tech Stack:** Node 18+ ESM, `node:test`, `node:http`, `node:net`, `node:tls`. No npm dependencies.

**Spec:** `docs/superpowers/specs/2026-10-20-upstream-mode-design.md`, with `runbooks/CONTEXT.md` and `runbooks/docs/adr/0003-mocked-upstream-served-by-plugin-server.md`, `runbooks/docs/adr/0004-mocked-runbooks-never-cover-endpoints.md`.

## Global Constraints

- All paths below are relative to `runbooks/` unless they start with `docs/superpowers/`. Run tests with `npm test` from `runbooks/`.
- `scripts/upstream-server.mjs` imports only `node:` modules and nothing from `scripts/lib/`, because `setup` copies it alone into projects.
- Server host is `127.0.0.1`; default port `4010`; control routes live under `/__runbooks/`.
- Default `upstream.fixtures` is `<paths.runbooks>/_fixtures`. Fixtures of runbook `<capability>.<flow>` live in `<upstream.fixtures>/<capability>/<flow>/`, step overrides in `<flow>/<Sxx>/`.
- A config without `upstream` means `live`; nothing changes for existing projects.
- `upstream.schema` accepts a local OpenAPI 3 JSON file only. YAML schemas and URLs are out of this plan.
- Recorded fixtures never keep `set-cookie`, `authorization`, `cookie`, nor any header in `upstream.redactHeaders` (case-insensitive).
- Env vars given to scripts: `RUNBOOKS_UPSTREAM_URL` (the server origin, for control calls) and `RUNBOOKS_RUN_ID` (the run suffix).
- Plugin prose is English, headings in sentence case, no em dashes. Commits use `feat(runbooks): <summary>` and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- The app's upstream URL has a path prefix (`https://api.example.com/v1`). The proxy must forward `/v1/invoices` to the target origin unchanged, and fixtures keep the full path. Test in Task 7.
- The app adds cache-busting or reordered query params (`?_t=123&page=1`). A fixture with `{ page: "1" }` must still match. Test in Task 6.
- The live API compresses responses while recording. The recorder must ask for `accept-encoding: identity` so stored bodies are plain JSON. Test in Task 8.
- Port 4010 is already taken (a second run, another dev server). `runbooks.mjs upstream` must exit 2 with a message naming the port and `upstream.port`, not a stack trace. Test in Task 9.
- A fixture with no JSON body (a `204`, a `text/csv` export). The server must send no body for 204 and the raw string with its content type otherwise. Test in Task 6.

---

### Task 1: `upstream` block in the config

**Files:**
- Modify: `scripts/lib/config.mjs`
- Modify: `templates/runbooks.config.json` (no `upstream` key: absent means live; leave it out and add nothing)
- Test: `scripts/runbooks.test.mjs`

**Interfaces:**
- Produces: `config.upstream` is `null` or `{ mode, baseUrl, start, root, urlEnv, port, fixtures, schema, redactHeaders, tokenEnv, serverFile }` with defaults `baseUrl: ''`, `start: []`, `root: null`, `urlEnv: ''`, `port: 4010`, `fixtures: '<paths.runbooks>/_fixtures'`, `schema: null`, `redactHeaders: []`, `tokenEnv: ''`, `serverFile: null`.
- Produces: `export const upstreamModeOf = (config) => 'live' | 'mocked'` (`config.upstream?.mode ?? 'live'`).

- [ ] **Step 1: Write the failing tests** in `scripts/runbooks.test.mjs`, using the file's `tmpProject` and `CONFIG_PATH`:

```js
test('loadConfig: no upstream block means live', () => {
  const config = loadConfig(tmpProject({ [CONFIG_PATH]: '{ "version": 1 }' }))
  assert.equal(config.upstream, null)
  assert.equal(upstreamModeOf(config), 'live')
})

test('loadConfig fills upstream defaults', () => {
  const dir = tmpProject({ [CONFIG_PATH]: JSON.stringify({ version: 1, upstream: { mode: 'mocked', urlEnv: 'NEXT_PUBLIC_API_URL' } }) })
  const { upstream } = loadConfig(dir)
  assert.deepEqual(upstream, {
    mode: 'mocked', baseUrl: '', start: [], root: null, urlEnv: 'NEXT_PUBLIC_API_URL', port: 4010,
    fixtures: 'docs/runbooks/_fixtures', schema: null, redactHeaders: [], tokenEnv: '', serverFile: null,
  })
})

test('loadConfig rejects a bad upstream block', () => {
  const bad = (upstream, extra = {}) => tmpProject({ [CONFIG_PATH]: JSON.stringify({ version: 1, upstream, ...extra }) })
  assert.throws(() => loadConfig(bad({ mode: 'fake' })), /upstream.mode must be one of live, mocked/)
  assert.throws(() => loadConfig(bad({ mode: 'live' }, { stack: 'backend' })), /upstream applies only to ui runbooks, and a backend stack has none/)
  assert.throws(() => loadConfig(bad({ mode: 'mocked' })), /upstream.urlEnv is required when upstream.mode is mocked/)
  assert.throws(() => loadConfig(bad({ mode: 'live', port: 70000 })), /upstream.port must be an integer from 1 to 65535/)
  assert.throws(() => loadConfig(bad({ mode: 'live', schema: 'openapi.yaml' })), /upstream.schema must be a JSON file/)
  assert.throws(() => loadConfig(bad({ mode: 'live', redactHeaders: 'x-key' })), /upstream.redactHeaders must be a list of header names/)
})
```

- [ ] **Step 2: Run** `npm test`. Expected: the three tests FAIL (`upstreamModeOf` is not exported).

- [ ] **Step 3: Implement** `validateUpstream(upstream, stack)` beside `validateDesign`, the defaults merge in `loadConfig` (after `paths` is merged, so `fixtures` uses `config.paths.runbooks`), `DEFAULTS.upstream = null`, and `upstreamModeOf`.

- [ ] **Step 4: Run** `npm test`. Expected: PASS, every older test included.

- [ ] **Step 5: Commit** `feat(runbooks): add the upstream block to the config`.

---

### Task 2: `upstream:` in runbooks, and loader warnings

**Files:**
- Create: `scripts/lib/fixtures.mjs` with `fixturesDir` only (Task 5 adds the rest)
- Modify: `scripts/lib/runbooks.mjs` (`readRunbook` gets `projectRoot`), `scripts/runbooks.mjs` (`runbookWarnings`)
- Test: `scripts/runbooks.test.mjs`, `scripts/cli.test.mjs`

**Interfaces:**
- Consumes: `config.upstream`, `upstreamModeOf` (Task 1).
- Produces: `fixturesDir(config, runbook) => string` in `scripts/lib/fixtures.mjs`: `<upstream.fixtures>/<capability>/<flow>`, relative to the project root.
- Produces: each runbook has `upstream: 'live' | 'mocked' | null` (`null` for `api`) and `warnings: string[]`. Warnings never make a runbook invalid; `problems` still do.
- Produces: `runbookWarnings(runbooks)` in `scripts/runbooks.mjs` prints `problems` and `warnings`, each as `<path>: <text>`.

- [ ] **Step 1: Write the failing tests.** In a `tmpProject` with a `frontend` config whose `upstream` is `{ mode: 'live', urlEnv: 'API_URL' }` and three runbooks:

```js
test('a ui runbook takes the project mode unless it overrides it', () => {
  const byId = Object.fromEntries(loadRunbooks(dir, loadConfig(dir)).map((rb) => [rb.id, rb]))
  assert.equal(byId['billing.issue'].upstream, 'live')        // no upstream key
  assert.equal(byId['billing.errors'].upstream, 'mocked')     // upstream: mocked
  assert.deepEqual(byId['billing.errors'].warnings, [
    'mocked runbook without a script: no automated run checks its fixtures',
    'mocked runbook has no fixtures in docs/runbooks/_fixtures/billing/errors',
  ])
  assert.deepEqual(byId['billing.errors'].problems, [])
})

test('upstream problems', () => {
  // upstream: fake            -> 'upstream "fake" must be one of live, mocked'
  // surface: api + upstream   -> 'upstream applies only to ui runbooks'   (fullstack config)
  // upstream: mocked, config without urlEnv -> 'a mocked runbook needs upstream.urlEnv in the config'
})
```

Write the second test as three assertions on `problems`, one runbook each. Add to `scripts/cli.test.mjs`: `list` on that project exits 0 and its stderr contains `warning: docs/runbooks/billing/errors.md: mocked runbook without a script`.

- [ ] **Step 2: Run** `npm test`. Expected: FAIL (`upstream` is undefined on runbooks).

- [ ] **Step 3: Implement** in `readRunbook(file, rel, config, projectRoot)`. The fixtures warning is skipped for `placeholder` runbooks, and the folder is `<upstream.fixtures>/<capability>/<flow>` resolved against `projectRoot`. A `mocked` runbook in a config without `upstream` gets the urlEnv problem.

- [ ] **Step 4: Run** `npm test`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(runbooks): read each ui runbook's upstream mode`.

---

### Task 3: Mocked runbooks never cover endpoints

**Files:**
- Modify: `scripts/lib/coverage.mjs`, `scripts/lib/format.mjs` (`coverageMarkdown`), `templates/coverage.html` (uncovered table)
- Test: `scripts/coverage.test.mjs`

**Interfaces:**
- Consumes: `runbook.upstream` (Task 2).
- Produces: an `api-endpoint` entry counts only through runbooks whose `upstream !== 'mocked'`, in every stack. Uncovered items, and `items` with `withItems`, carry `citedByMocked: string[]` (ids of valid, non-deprecated mocked runbooks citing them) only when non-empty.

- [ ] **Step 1: Write the failing test.** Copy the fixture project to a temp dir (`fs.cpSync(FIXTURE, dir, { recursive: true })`), add `upstream: { "mode": "live", "urlEnv": "API_URL" }` to its config and `upstream: mocked` to `billing/issue-invoice.md`, then:

```js
test('a mocked runbook covers its screens but not its endpoints', () => {
  const result = coverageOf(dir)
  const uncovered = Object.fromEntries(result.entries.uncovered.map((i) => [i.id, i]))
  assert.deepEqual(uncovered['POST /admin/invoices'].citedByMocked, ['billing.issue-invoice'])
  assert.equal(result.entries.uncovered.some((i) => i.id === '/financeiro/faturas'), false)
  assert.match(coverageMarkdown(result, 'overall'), /`POST \/admin\/invoices`.*cited, not covered \(mocked: billing\.issue-invoice\)/)
})
```

`coverageOf(root)` is the existing `fixtureCoverage` body with `root` as a parameter; refactor the helper so both tests share it.

- [ ] **Step 2: Run** `npm test`. Expected: FAIL.

- [ ] **Step 3: Implement.** Build endpoint refs from `valid.filter((rb) => rb.upstream !== 'mocked')` and keep `allEntryRefs` for `ui-route` entries in a `frontend` stack. In `coverage.html`, the uncovered row's "where" cell appends `cited, not covered (mocked)` when `citedByMocked` is set, and `writeCoverage` passes the field through unchanged.

- [ ] **Step 4: Run** `npm test`. Expected: PASS, with the existing coverage totals unchanged.

- [ ] **Step 5: Commit** `feat(runbooks): mocked runbooks never cover endpoints`.

---

### Task 4: One JUnit state per step and viewport

**Files:**
- Modify: `scripts/lib/junit.mjs`, `scripts/lib/format.mjs` (`junitMarkdown`), `scripts/runbooks.mjs` (`commandJunit`, `USAGE`)
- Test: `scripts/junit.test.mjs`

**Interfaces:**
- Produces: `parseSteps(body)` rows gain `viewports: string[]` from a `Viewports:` line (`[]` means every viewport).
- Produces: `viewportOfTest(testCase) => string | null`, reading a trailing `@ <viewport>` from the test name (`/@\s*([a-z0-9][a-z0-9-]*)\s*$/i`).
- Produces: `stepStates(steps, cases, { waived = [], viewports = [] } = {})`. With `viewports` empty it behaves exactly as today. Otherwise it returns one row per viewport and step that runs there, in viewport order, each `{ step, viewport, title, state, seen, tests }`. Parents resolve inside the same viewport. A test whose viewport is missing from the runbook, or missing from its name, goes to `extra` as `{ step, viewport, test }`.

- [ ] **Step 1: Write the failing test** with a body of S01 (`Parents: none`), S02 (`Parents: S01`) and S03 (`Parents: none`, `Viewports: desktop`), viewports `['desktop', 'mobile']`, and cases `S01 a @ desktop` passed, `S01 a @ mobile` failed, `S02 b @ desktop` passed, `S02 b @ mobile` passed, `S03 c @ desktop` passed, `S03 c @ tablet` passed:

```js
const { steps, result, extra } = stepStates(parseSteps(BODY_VP), CASES_VP, { viewports: ['desktop', 'mobile'] })
assert.deepEqual(steps.map((s) => `${s.viewport} ${s.step} ${s.state}`), [
  'desktop S01 passed', 'desktop S02 passed', 'desktop S03 passed',
  'mobile S01 failed', 'mobile S02 blocked-by-parent',
])
assert.equal(result, 'failed')
assert.deepEqual(extra, [{ step: 'S03', viewport: 'tablet', test: 'S03 c @ tablet' }])
```

Also assert that `junitMarkdown` prints a `Viewport` column with these rows, and that `run(['junit', ...])` on a runbook with `viewports: [desktop, mobile]` passes them through.

- [ ] **Step 2: Run** `npm test`. Expected: FAIL.

- [ ] **Step 3: Implement.** `States:` in `junitMarkdown` keeps listing every row's state, which is what `status --states` needs.

- [ ] **Step 4: Run** `npm test`. Expected: PASS, and the existing junit tests are unchanged.

- [ ] **Step 5: Commit** `feat(runbooks): map JUnit tests to steps per viewport`.

---

### Task 5: Fixtures and the schema check

**Files:**
- Create: `scripts/lib/schema.mjs`
- Modify: `scripts/lib/fixtures.mjs` (Task 2 created it), `scripts/runbooks.mjs` (new `fixtures` command, `PROJECT_COMMANDS`, `USAGE`)
- Test: create `scripts/fixtures.test.mjs`

**Interfaces:**
- Consumes: `fixturesDir` (Task 2).
- Fixture file (JSON, any name ending `.json`): `{ "request": { "method", "path", "query"? }, "response": { "status", "headers"?, "body"? }, "source" }`.
- Produces: `loadFixtures(root, dir) => { fixtures: Array<{ file, step: string|null, request, response, source }>, problems: string[] }`. `step` is the `Sxx` subfolder name or `null`. Invalid JSON or a missing `request.method`/`request.path`/`response.status` is a problem naming the file.
- Produces: `sourceCounts(fixtures) => { recorded, schema, handWritten }`, by the prefix of `source` (`recorded `, `schema`, `hand-written`).
- Produces: `validateSchema(value, schema, doc) => string[]`, supporting `type` (with `integer` and `nullable`), `properties`, `required`, `items`, `enum`, local `$ref` (`#/...`), `allOf`, `oneOf`/`anyOf` (valid when any branch is). Other keywords are ignored. Messages name the JSON path: `body.items[0].total: expected number, got string`.
- Produces: `checkFixtures(fixtures, doc) => string[]`. It finds `paths[template][method].responses[status | 'default'].content['application/json'].schema`, matching templates like `/invoices/{id}` against `/invoices/42`. No operation means `<file>: no operation for GET /x in the schema`. A non-JSON response is skipped.
- Produces: the CLI `runbooks.mjs fixtures <id> [--json]` prints `{ id, dir, fixtures, sources, problems }`. It exits 0 when problems exist (they are findings) and 2 only when the id or the config is unusable.

- [ ] **Step 1: Write the failing tests** in `scripts/fixtures.test.mjs`. Cover `loadFixtures` with a runbook-level and an `S03/` fixture plus a broken file; `sourceCounts`; `validateSchema` on a `$ref`'d object with a wrong-typed field, a missing required field, `nullable: true` accepting `null`, and an `enum`; `checkFixtures` with a template path match and with a missing operation; the CLI on a temp project, asserting `problems` holds the type error.

- [ ] **Step 2: Run** `npm test`. Expected: FAIL (modules missing).

- [ ] **Step 3: Implement** both modules and the command.

- [ ] **Step 4: Run** `npm test`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(runbooks): load fixtures and check them against the OpenAPI schema`.

---

### Task 6: Upstream server, mocked mode and control routes

**Files:**
- Create: `scripts/upstream-server.mjs`
- Test: create `scripts/upstream-server.test.mjs` (start each server on port `0`, close it in `t.after`)

**Interfaces:**
- Produces: `export const VERSION = '1.1.0'` (kept equal to `.claude-plugin/plugin.json` by Task 10's test).
- Produces: `createUpstreamServer({ fixturesRoot, target = '', redactHeaders = [], log = () => {} }) => http.Server`, with state `{ runbook: null, mode: 'mocked', step: null }`.
- Produces: `matchFixture(fixtures, { method, path, query }, step) => fixture | null`. A candidate needs an equal method and path, and every query key it names equal in the request. Candidates from the current step's folder win over runbook-level ones; then more query keys win.
- Control routes: `POST /__runbooks/select` with JSON `{ runbook?, mode?, step? }` (mode in `mocked`, `live`, `record`) returns the new state and clears the log. `GET /__runbooks/state` returns `{ runbook, mode, step, requests, unmatched: [{ method, path, step }] }`.
- Mocked responses read the runbook's fixtures from disk on every request (`<fixturesRoot>/<capability>/<flow>`). With no match: `501` and `{ "error": "no fixture", "method", "path", "runbook", "step" }`; with no runbook selected: `501` and `{ "error": "no runbook selected" }`. CORS: `access-control-allow-origin` echoes `Origin` (else `*`), plus `access-control-allow-credentials: true` when `Origin` is set; `OPTIONS` answers `204` with `access-control-allow-methods: GET,POST,PUT,PATCH,DELETE,OPTIONS` and echoes `access-control-request-headers`.

- [ ] **Step 1: Write the failing tests:** a selected runbook serves its fixture; `S03` overrides it after `select { step: 'S03' }`; `GET /invoices?_t=9&page=1` matches a fixture with `query: { page: '1' }`; an unknown request gets the 501 body and appears in `state.unmatched`; no runbook selected gets 501; the preflight answer and the credentials header; a `204` fixture sends an empty body; a `text/csv` fixture sends the string with that content type; `matchFixture` ranking as a unit test.

- [ ] **Step 2: Run** `npm test`. Expected: FAIL.

- [ ] **Step 3: Implement** with `node:http` only. The server has its own fixture reader, because it cannot import `scripts/lib/fixtures.mjs` (Global Constraints). The file stays importable without side effects; its CLI entry comes in Task 9.

- [ ] **Step 4: Run** `npm test`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(runbooks): serve fixtures from the upstream server`.

---

### Task 7: Live proxy, SSE and WebSocket

**Files:**
- Modify: `scripts/upstream-server.mjs`
- Test: `scripts/upstream-server.test.mjs` (a second local `http.Server` plays the live API)

**Interfaces:**
- Consumes: `createUpstreamServer` (Task 6).
- Produces: in `live` mode every non-control request goes to `new URL(target).origin` with its path and query unchanged, method, headers and body piped, and `host` rewritten to the target's host. The response streams back unbuffered. On `upgrade`, it opens a `net`/`tls` socket to the target, writes the request head with the rewritten `host`, and pipes both ways. A target that refuses the connection gets `502` and `{ "error": "upstream unreachable", "target" }`.

- [ ] **Step 1: Write the failing tests:** `POST /v1/invoices` with a JSON body reaches the fake API with the same path, body and a rewritten `host`, while `target` is `http://127.0.0.1:<fake>/v1` (Review Focus, path prefix); an SSE endpoint's first event arrives before the fake API ends the response; a raw WebSocket upgrade round-trips one frame through a fake server that answers `101`; a dead target gets the 502 body.

- [ ] **Step 2: Run** `npm test`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run** `npm test`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(runbooks): proxy live runbooks through the upstream server`.

---

### Task 8: Record mode

**Files:**
- Modify: `scripts/upstream-server.mjs`
- Test: `scripts/upstream-server.test.mjs`

**Interfaces:**
- Consumes: the proxy from Task 7.
- Produces: in `record` mode the server proxies with `accept-encoding: identity`, buffers the response, sends it to the client, and writes a fixture. The file name is `<method>-<path, every char outside [a-z0-9] as ->.json` in lowercase, with `-<first 8 hex of sha1(query)>` before `.json` when the query is not empty. Placement: the runbook folder when it has no fixture for that request; nothing when the existing one has the same status and body; else the current step's folder (the runbook folder when no step is selected). Saved headers drop `set-cookie`, `authorization`, `cookie`, `content-length`, `content-encoding`, `transfer-encoding`, `connection` and `redactHeaders`. A JSON `content-type` stores the parsed body; anything else stores the string. `source` is `recorded <YYYY-MM-DD> from <target origin>`.

- [ ] **Step 1: Write the failing tests:** a first `GET /invoices` writes `get--invoices.json` at the runbook level with a parsed body and no `set-cookie`, `authorization`, or `x-api-key` when `redactHeaders: ['X-Api-Key']`; the same response again writes nothing; a different body after `select { step: 'S03' }` writes `S03/get--invoices.json`; the fake API sees `accept-encoding: identity` (Review Focus, compression).

- [ ] **Step 2: Run** `npm test`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run** `npm test`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(runbooks): record fixtures from the live upstream API`.

---

### Task 9: `runbooks.mjs upstream` and the copied-server warning

**Files:**
- Modify: `scripts/runbooks.mjs`, `scripts/upstream-server.mjs` (CLI entry)
- Create: `scripts/lib/upstream.mjs`
- Test: `scripts/cli.test.mjs`

**Interfaces:**
- Consumes: `createUpstreamServer` and `VERSION` (Task 6), `config.upstream` (Task 1).
- Produces: `upstreamOptions(root, config, options) => { fixturesRoot, target, redactHeaders, port, mode, runbook, step }`. `fixturesRoot` is absolute, `port` comes from `--port` else `config.upstream.port`, `mode` defaults to `config.upstream.mode`, and `runbook`/`step` come from `--runbook`/`--step` (default `null`). It throws `the config has no upstream block. Run /runbooks:setup` when `upstream` is `null`.
- Produces: `copiedServerWarning(root, config, version) => string | null`. When `upstream.serverFile` is set and missing, it returns `upstream.serverFile <path> is missing: run /runbooks:setup to copy it`. When the file's `VERSION` differs, it returns `upstream.serverFile <path> is from runbooks <x>, the plugin is <y>: run /runbooks:setup to refresh it`. `list` and `coverage` add it to their warnings.
- Produces: `node scripts/runbooks.mjs upstream [--port n] [--mode mocked|live|record] [--runbook id] [--step Sxx]` runs in the foreground, outside `run()`, and prints `runbooks-upstream listening on http://127.0.0.1:<port>`. On `EADDRINUSE` it exits 2 with `runbooks: port <port> is in use; stop what holds it or change upstream.port`. `node upstream-server.mjs --fixtures <dir> --port <n> [--target <url>] [--redact a,b] [--mode m] [--runbook id]` does the same for the copied file.

- [ ] **Step 1: Write the failing tests:** `upstreamOptions` on a temp project; the no-upstream error; `copiedServerWarning` for a missing file and for a copy whose `VERSION` is `'0.9.0'`; spawning `runbooks.mjs upstream --port 0` prints the listening line (read the first stdout line, then kill the child); spawning it on a port held by a test server exits 2 with the port message (Review Focus, port in use).

- [ ] **Step 2: Run** `npm test`. Expected: FAIL.

- [ ] **Step 3: Implement.** The `upstream` branch lives in the invoked-path block of `runbooks.mjs`, before `run(argv)`, because `run()` returns synchronously.

- [ ] **Step 4: Run** `npm test`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(runbooks): start the upstream server from the config`.

---

### Task 10: References, templates and the agent rules

**Files:**
- Create: `skills/runbooks/references/upstream.md`
- Modify: `skills/runbooks/references/config.md`, `skills/runbooks/references/format.md`, `skills/runbooks/references/coverage.md`, `skills/runbooks/SKILL.md`, `templates/runbook.md`, `templates/run-report.md`, `templates/agents-block.md`, `scripts/plugin.test.mjs`

**Interfaces:**
- Consumes: every key, route, command and message from Tasks 1 to 9, copied exactly.
- Produces: `references/upstream.md`, the page every command links to for the server. Commands in Tasks 11 to 13 cite its section names: "Modes", "Fixtures", "Server", "Control routes", "Recording", "Scripts".

- [ ] **Step 1: Write the failing test** in `scripts/plugin.test.mjs`: `VERSION` exported by `scripts/upstream-server.mjs` equals `.claude-plugin/plugin.json` `version`; `references/upstream.md` has the six section headings above.

- [ ] **Step 2: Run** `npm test`. Expected: FAIL (the reference does not exist).

- [ ] **Step 3: Write the docs.**
  - `references/upstream.md`: the six sections, from the spec's "Modes", "The upstream server", "Fixtures", "Scripts of mocked runbooks" and "Live mode", with the fixture file shape from Task 5, the routes from Task 6, the record rules from Task 8 and both CLI forms from Task 9.
  - `config.md`: an `upstream` row in the key table and an "Upstream" section with the keys, defaults and errors from Task 1. Link `references/upstream.md`.
  - `format.md`: an `upstream` frontmatter row; in "What a step can verify", the mocked rule (the request a screen sends, never persistence); in Preconditions, a mocked runbook's data is its fixtures, a live one's carries the run suffix.
  - `coverage.md`: under "By surface", a paragraph for mocked runbooks citing ADR 0004 by `${CLAUDE_PLUGIN_ROOT}/docs/adr/0004-mocked-runbooks-never-cover-endpoints.md`.
  - `SKILL.md` and `agents-block.md`: `ui` results are verified in the browser, or by their script in mode `test` when the script has one test per step; the agent calls only the server's control routes, which verify nothing.
  - `templates/runbook.md`: a commented `upstream:` line that appears only when the runbook differs from the project default.
  - `templates/run-report.md`: `upstream: <live | mocked>` in the frontmatter, and a Notes line for fixtures not recorded from the live API.

- [ ] **Step 4: Run** `npm test`. Expected: PASS. Also run `grep -rn "—" skills templates` and expect no new match.

- [ ] **Step 5: Commit** `docs(runbooks): document upstream mode`.

---

### Task 11: `setup`, `settings` and `upgrade`

**Files:**
- Modify: `commands/setup.md`, `commands/settings.md`, `commands/upgrade.md`

**Interfaces:**
- Consumes: `references/upstream.md` (Task 10), `upstreamOptions` and its errors (Task 9).

- [ ] **Step 1: Edit `setup.md`.**
  - Step 1, Detect: where the app's upstream URL lives (`.env.example` keys ending in `API_URL`, `API_BASE_URL`), for `upstream.urlEnv`; whether the upstream API runs in the app's own process (Next route handlers, Laravel with Blade or Inertia); existing request interception in tests (`page.route`, `cy.intercept`, `msw`).
  - Step 2: after the `ui` framework, ask the upstream mode only when the upstream API is outside the app's process, recommending as the spec's Setup section says. When the answer is `mocked`, the question text says that endpoints of the sibling repo then count only through `live` runbooks (ADR 0004). With no `tests.ui`, it also gives the warning: no automated run checks the fixtures, and only `runbooks.mjs fixtures` with a schema or `list --affected` notices an API change. Then ask `urlEnv`, `baseUrl`, `start` and `root` (taken from `tests.api.root` in a `fullstack` stack without asking), `schema` and `redactHeaders` only when detection left them open.
  - Step 3: write the `upstream` block. When `tests.ui` exists and some runbook can be mocked, copy `${CLAUDE_PLUGIN_ROOT}/scripts/upstream-server.mjs` to `<tests.ui.dir>/runbooks-upstream.mjs` and write that path to `upstream.serverFile`; show how the framework starts it (Playwright `webServer`, Cypress `setupNodeEvents`) without editing the framework config.
  - Step 4, summary: the mode, the URL env var, the copied server path.
- [ ] **Step 2: Edit `settings.md`:** an `upstream` group (every `upstream.*` key, only with `ui`) in the group table, and a row in the "Also" table: switching the default mode lists the runbooks whose effective mode changes and offers `/runbooks:update <id>` for each.
- [ ] **Step 3: Edit `upgrade.md`:** when the config has `upstream.serverFile`, the offer of `/runbooks:setup` after the restart also says it refreshes the copied server. The command still writes no project file.
- [ ] **Step 4: Verify.** Run `npm test` and expect PASS. Then reread the three diffs against the spec's Setup and Settings sections, line by line.
- [ ] **Step 5: Commit** `docs(runbooks): set up and change upstream mode`.

---

### Task 12: `create`, `update` and `audit-runbooks`

**Files:**
- Modify: `commands/create.md`, `commands/update.md`, `commands/audit-runbooks.md`

**Interfaces:**
- Consumes: `references/upstream.md` "Fixtures" and "Recording"; `runbooks.mjs upstream` and `fixtures` (Tasks 5, 9).

- [ ] **Step 1: Edit `create.md`.**
  - Step 2, after viewports: each `ui` runbook takes the project mode. Write `upstream:` only to override it.
  - Step 3: list the scenarios that need an upstream failure (500, timeout). In a `live` runbook, propose a second runbook `<flow>-upstream-errors`, mocked, holding only those, when there is at least one.
  - Step 4: a `live` runbook's data gets the run suffix. Scripts create it through the upstream API with the role's `accounts`, or `upstream.tokenEnv`.
  - Step 5: a `mocked` runbook writes request checks instead of persistence, with persistence under "Not covered". Then record its fixtures through `/runbooks:run <id> --record` when `upstream.baseUrl` answers; otherwise write them from `upstream.schema`, else by hand, each with its `source`.
  - Step 6: show the fixtures diff with the runbook.
- [ ] **Step 2: Edit `update.md`:** a mode change rewrites the content as the spec's "Runbook content" says, in both directions. A step change in a mocked runbook re-records the affected fixtures.
- [ ] **Step 3: Edit `audit-runbooks.md`:** two rows in the check table. A mocked runbook with a step whose Expected checks persistence after a reload is `stale`. A live runbook that still has a fixtures folder is `stale`, with the edit "delete `<dir>` or set `upstream: mocked` through `/runbooks:update`".
- [ ] **Step 4: Verify.** Run `npm test` and expect PASS, then reread against the spec.
- [ ] **Step 5: Commit** `docs(runbooks): write and update runbooks per upstream mode`.

---

### Task 13: `run`, run modes, `to-test` and `check`

**Files:**
- Modify: `commands/run.md`, `skills/runbooks/references/run-modes.md`, `commands/to-test.md`, `commands/check.md`

**Interfaces:**
- Consumes: `runbooks.mjs upstream`, `fixtures`, `junit --file` with viewports (Tasks 4, 5, 9); control routes (Task 6).

- [ ] **Step 1: Edit `run.md`.**
  - Parameters: `--record`, which runs the selection live with the server in `record` mode.
  - Step 1: offer `test` for `ui` runbooks whose script has one test per step.
  - Step 2: when the project has any mocked runbook (`list --json`), or the run has `--record`, start `runbooks.mjs upstream` in the background, because the app then points at the server for live runbooks too; check that the app reaches it. Navigate once, then read `GET /__runbooks/state`; zero `requests` means the app points elsewhere, so show `<urlEnv>=http://127.0.0.1:<port> <app.start>` and stop. For a live runbook, `upstream.baseUrl` must answer, else show `upstream.start`. With `upstream.schema`, run `runbooks.mjs fixtures <id>` before the first step; problems make the runbook `blocked` and offer `/runbooks:update <id>`.
  - Step 4: before each runbook select it, and before each step select the step. After each step read `unmatched`; an unmatched request makes the step `blocked` naming the request, and offers `/runbooks:update <id>`.
  - Step 5: write `upstream` in the report, the fixtures folder as evidence, and the count of fixtures not recorded from the live API.
- [ ] **Step 2: Edit `run-modes.md`:** a `test` section line for `ui` runbooks (same flow as `api`, with `RUNBOOKS_UPSTREAM_URL` and `RUNBOOKS_RUN_ID` in the command's env and `junit` read with viewports); in "guided", the agent selects the step on the server before showing it.
- [ ] **Step 3: Edit `to-test.md`:** item 5 gets a "`ui`, mocked" shape. It has one test per step named `S01 <title>`, or `S01 <title> @ <viewport>` with viewports. Each test's `beforeEach` posts `select` to `RUNBOOKS_UPSTREAM_URL`, and no screenshots are taken for design. "`ui`, live" scripts create data through the upstream API with the run suffix from `RUNBOOKS_RUN_ID`. Item 6 runs the command with the server started. Item 8 names the copied server file the CI job must start.
- [ ] **Step 4: Edit `check.md`:** step 3 also shows the report's `upstream`.
- [ ] **Step 5: Verify.** Run `npm test` and expect PASS, then reread against the spec's "Where runs happen", "Fixtures" and "Scripts of mocked runbooks".
- [ ] **Step 6: Commit** `docs(runbooks): run runbooks in either upstream mode`.

---

### Task 14: Version

**Files:**
- Modify: `.claude-plugin/plugin.json` (`1.2.0`), `scripts/upstream-server.mjs` (`VERSION = '1.2.0'`), `README.md` (one paragraph on upstream mode, linking `references/upstream.md`)

- [ ] **Step 1: Bump both versions** and write the README paragraph.
- [ ] **Step 2: Run** `npm test`. Expected: PASS, including the version test from Task 10.
- [ ] **Step 3: Commit** `chore(runbooks): bump to 1.2.0`.
