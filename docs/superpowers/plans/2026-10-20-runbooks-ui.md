# Runbooks UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/runbooks:ui`, a local read-only server and single page app that shows capabilities and their runbooks (with stale ones in red), each runbook's detail and run history, and coverage, and remove `runs.html`, `coverage.html` and the `output` subcommand they came from.

**Architecture:** Pure functions in `scripts/lib/` build JSON view models from the files on disk: the stale rule, run report listing, a Markdown renderer, a runbook body parser, and one module (`explore.mjs`) that assembles the four views. `scripts/ui-server.mjs` serves those views as JSON plus one HTML file (`templates/ui.html`, inline CSS and vanilla JS, hash routes) and reads the disk on every request. `runbooks.mjs ui` starts it in the foreground, as `runbooks.mjs upstream` does. The Markdown commands change last, once the scripts they call exist.

**Tech Stack:** Node 18+ ESM, `node:test`, `node:http`. No npm dependencies.

**Spec:** `docs/superpowers/specs/2026-10-20-runbooks-ui-design.md`. Mockups (local, not committed): `.superpowers/brainstorm/13963-1792533766/content/layout-v4.html`, `history.html` (option B), `coverage.html`, `runbook-v2.html`.

## Global Constraints

- All paths below are relative to `runbooks/` unless they start with `docs/superpowers/`. Run tests with `npm test` from `runbooks/`.
- The server listens on `127.0.0.1` only. Default port `4020`, overridden by `--port`. No config key for the port.
- Every request whose `Host` header does not name `127.0.0.1`, `localhost` or `[::1]` (any port) gets a 403. The server sends no CORS headers.
- The server only reads. No route writes, deletes or runs anything.
- The server reads the files on every request and keeps no cache.
- Config key `staleDays`, default `30`, a positive integer. Stale means age in whole days `> staleDays`, so exactly 30 days old is not stale.
- Only `active` and `draft` runbooks can be stale. A runbook without `last_run.date` is stale. `last_run.outdated` never makes a runbook stale.
- A report path from a URL is never joined to the file system. Report names are checked against `/^\d{4}-\d{2}-\d{2}-\d{4}-[\w-]+\.[\w-]+\.md$/` and against the names `fs.readdirSync(<_runs>)` returns.
- The Markdown renderer escapes `&`, `<`, `>`, `"` and `'` before adding any tag. Link `href`s keep only `http:`, `https:` and relative targets.
- UI text in English. Dark only. Palette and fonts of the current `templates/runs.html`: `--bg:#0e0d0b; --panel:#161512; --line:#2a2823; --fg:#ebe8e1; --muted:#9a968c; --accent:#e07a55; --prompt:#8fbf6a; --failed:#e5655c; --blocked:#d9a441`, Geist and Geist Mono from Google Fonts. Body text 15px. Sidebar 220px. Content container `max-width: 960px; margin: 0 auto`.
- Hash routes: `#/runbooks`, `#/runbooks/<capability>`, `#/runbook/<id>`, `#/runbook/<id>/history`, `#/runbook/<id>/history/<report name>`, `#/coverage`, `#/coverage/<slice>`. The group without a slice is `(no slice)` in the data, shown as "no slice", and routed as `#/runbooks/~none` and `#/coverage/~none`.
- Plugin version `1.3.0`, in `.claude-plugin/plugin.json` and in `scripts/upstream-server.mjs` (`VERSION` and the header comment).
- Plugin prose in English, headings in sentence case, no em dashes. Commits use `feat(runbooks): <summary>` (or `refactor`, `docs`, `chore`) and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A run report from an older plugin version, without `branch`, `mode`, `upstream` or a step table (the fixture `_runs/2026-10-01-0900-billing.issue-invoice.md` is one line). The history list must show `-` in the missing columns and the panel must render, not throw. Test in Task 2.
- A report with a `Viewport` column. Step states must be read per viewport, and the column order must come from the header row, not from a fixed position. Test in Task 2.
- A runbook body with HTML in it (`<script>`, `<img onerror>`) or a `javascript:` link. The detail page must show the text, never run it. Test in Task 3.
- A runbook without a body section (no `## Not covered`), or steps without `Actions:`. The detail view must leave those parts out, not crash or show empty headings. Test in Task 4.
- A request for `/api/runs/..%2Frunbooks.config.json` or a report name of another project file. The server must answer 404. Test in Task 6.

---

### Task 1: `staleDays` config key and the stale rule

**Files:**
- Create: `scripts/lib/stale.mjs`
- Create: `scripts/stale.test.mjs`
- Modify: `scripts/lib/config.mjs` (`DEFAULTS`, validation in `loadConfig`)
- Modify: `skills/runbooks/references/config.md` (key table)
- Modify: `commands/settings.md` (group table)
- Modify: `templates/runbooks.config.json` (add `"staleDays": 30`)

**Interfaces:**
- Produces:
  - `config.staleDays: number` (default `30`) from `loadConfig`.
  - `todayLocal(now?: Date) -> string` (`YYYY-MM-DD`, local time zone).
  - `daysSince(date: string, today: string) -> number` (whole days, both `YYYY-MM-DD`, computed in UTC so DST never shifts it).
  - `staleState(runbook, { today: string, staleDays: number }) -> { stale: boolean, age: number | null }` where `age` is `null` when there is no `lastRun.date`.

- [ ] **Step 1: Write the failing tests** in `scripts/stale.test.mjs`

```js
test('daysSince counts whole days', () => {
  assert.equal(daysSince('2026-10-01', '2026-10-20'), 19)
  assert.equal(daysSince('2026-03-01', '2026-03-31'), 30) // crosses a DST change in many zones
})
test('staleState follows the status, the age and the limit', () => {
  const rb = (status, date) => ({ status, lastRun: date ? { date } : null })
  const opts = { today: '2026-10-20', staleDays: 30 }
  assert.deepEqual(staleState(rb('active', '2026-09-20'), opts), { stale: false, age: 30 })
  assert.deepEqual(staleState(rb('active', '2026-09-19'), opts), { stale: true, age: 31 })
  assert.deepEqual(staleState(rb('draft', null), opts), { stale: true, age: null })
  assert.deepEqual(staleState(rb('deprecated', null), opts), { stale: false, age: null })
  assert.deepEqual(staleState(rb('placeholder', null), opts), { stale: false, age: null })
  assert.deepEqual(staleState(rb(null, null), opts), { stale: false, age: null }) // invalid runbook
})
test('todayLocal formats the local date', () => {
  assert.equal(todayLocal(new Date(2026, 9, 5, 23, 59)), '2026-10-05')
})
test('staleDays defaults to 30 and must be a positive integer', () => {
  // write { version: 1 } and { version: 1, staleDays: 0 } / 'x' / 1.5 to temp configs
  // loadConfig -> staleDays 30; each invalid one throws ConfigError /staleDays must be a positive integer/
})
```

`lastRun.date` can arrive as a string or a number-like YAML scalar: compare with `String(lastRun.date)`.

- [ ] **Step 2: Run** `node --test scripts/stale.test.mjs`. Expected: FAIL, `stale.mjs` not found.

- [ ] **Step 3: Implement** `scripts/lib/stale.mjs` with the three functions above, and in `config.mjs` add `staleDays: 30` to `DEFAULTS` plus `if (!Number.isInteger(config.staleDays) || config.staleDays < 1) throw new ConfigError('staleDays must be a positive integer')`.

- [ ] **Step 4: Docs.** Add a `staleDays` row to the key table in `config.md` ("days after the last full run that make an `active` or `draft` runbook stale in `/runbooks:ui`"). Add a group `ui` with key `staleDays` to the group table in `settings.md`.

- [ ] **Step 5: Run** `npm test` from `runbooks/`. Expected: all pass.

- [ ] **Step 6: Commit** `feat(runbooks): add staleDays and the stale rule`.

---

### Task 2: List run reports and read one by name

**Files:**
- Modify: `scripts/lib/reports.mjs`
- Create: `scripts/reports.test.mjs`

**Interfaces:**
- Consumes: `splitFrontmatter`, `parseYaml` from `scripts/lib/yaml.mjs`.
- Produces:
  - Report objects gain `name: string` (file name), `upstream: string | null`, `viewports: string[]` (frontmatter `viewports`, `[]` when missing). `steps` entries are `{ step, state }`, plus `viewport` only when the report table has a `Viewport` column, so `check --json` output stays the same. `counts` counts every row.
  - `listReports(projectRoot, runbooksDir, id) -> Report[]`, newest first, partial runs included.
  - `reportByName(projectRoot, runbooksDir, name) -> (Report & { runbook: string, body: string }) | null`. `runbook` is the id from the name. `body` is the Markdown after the frontmatter. `null` when the name fails `RUN_NAME` or is not in `readdirSync(<_runs>)`.
  - `latestReport` keeps its signature and output.

- [ ] **Step 1: Write the failing tests.** Build temp projects the way `scripts/check.test.mjs` `project()` does. Cases:
  - three reports for `billing.pay` and one for `billing.pay-later`: `listReports(..., 'billing.pay')` returns the three, names newest first.
  - a report whose table is `| Step | State | Viewport | Seen | Evidence |` with rows `S01 passed desktop`, `S01 failed mobile`: `steps` equals `[{ step: 'S01', state: 'passed', viewport: 'desktop' }, { step: 'S01', state: 'failed', viewport: 'mobile' }]`.
  - a report with the columns in another order (`| Step | Viewport | State | ...`) reads the same states.
  - a one-line report with no frontmatter (copy `scripts/__fixtures__/project/docs/runbooks/_runs/2026-10-01-0900-billing.issue-invoice.md`): `branch`, `mode`, `upstream` are `null`, `steps` is `[]`, `date` is `null`.
  - `reportByName` returns `null` for `'../runbooks.config.json'`, `'2026-10-01-0900-billing.pay.md/../x'`, `'notes.md'`, and for a well-formed name with no file; returns `body` and `runbook: 'billing.pay'` for an existing one.

- [ ] **Step 2: Run** `node --test scripts/reports.test.mjs`. Expected: FAIL.

- [ ] **Step 3: Implement.** Replace `readSteps` with a reader that finds the first table whose header's first cell is `Step`, maps column names (`Step`, `State`, `Viewport`) to indexes, and reads each `| S\d+ |` row by those indexes. Export `RUN_NAME`. Keep `latestReport` on top of `listReports`.

- [ ] **Step 4: Run** `npm test`. Expected: all pass, `check.test.mjs` included.

- [ ] **Step 5: Commit** `feat(runbooks): list run reports and read per-viewport step states`.

---

### Task 3: Markdown renderer

**Files:**
- Create: `scripts/lib/markdown.mjs`
- Create: `scripts/markdown.test.mjs`

**Interfaces:**
- Produces: `renderMarkdown(text: string) -> string` (HTML). Supports `#`..`####` headings, paragraphs, `-` and `1.` lists (one level), pipe tables, fenced code blocks, inline code, `**bold**`, `[text](url)`, and `---` as `<hr>`. Anything else is a paragraph of escaped text.

- [ ] **Step 1: Write the failing tests**

```js
test('escapes HTML everywhere', () => {
  assert.equal(renderMarkdown('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
  assert.ok(!renderMarkdown('| a |\n|---|\n| <img src=x onerror=y> |').includes('<img'))
  assert.ok(!renderMarkdown('`<b>`').includes('<b>'))
})
test('drops unsafe link targets', () => {
  assert.equal(renderMarkdown('[x](javascript:alert(1))'), '<p>x</p>')
  assert.equal(renderMarkdown('[x](https://a.b/c)'), '<p><a href="https://a.b/c" target="_blank" rel="noreferrer">x</a></p>')
})
test('renders the blocks the templates write', () => {
  assert.equal(renderMarkdown('1. a\n2. b'), '<ol><li>a</li><li>b</li></ol>')
  assert.equal(renderMarkdown('- `x`: y'), '<ul><li><code>x</code>: y</li></ul>')
  assert.equal(renderMarkdown('| A | B |\n|---|---|\n| 1 | 2 |'), '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>')
  assert.equal(renderMarkdown('## Notes\n\nText **bold**.'), '<h2>Notes</h2><p>Text <strong>bold</strong>.</p>')
  assert.equal(renderMarkdown('```\na < b\n```'), '<pre><code>a &lt; b</code></pre>')
})
```

- [ ] **Step 2: Run** `node --test scripts/markdown.test.mjs`. Expected: FAIL.

- [ ] **Step 3: Implement** a line-based block parser, then inline formatting on already-escaped text (code spans first, so their content is not formatted).

- [ ] **Step 4: Run** `node --test scripts/markdown.test.mjs`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(runbooks): add a Markdown renderer for the UI`.

---

### Task 4: Runbook body parser

**Files:**
- Create: `scripts/lib/body.mjs`
- Create: `scripts/body.test.mjs`

**Interfaces:**
- Consumes: `renderMarkdown` (Task 3).
- Produces: `parseBody(body: string) -> { sections: Array<{ heading: string, html: string }>, steps: Step[] }`.
  - `sections` holds every `##` section except `Steps`, in file order, with the `---` separator lines dropped. A section with no text is left out.
  - `Step = { step: string, title: string, fields: Array<{ name: string, value: string }>, actions: string | null, request: string | null, expected: string | null }`. `fields` are the `Name: value` lines before `Actions:`/`Request:`/`Expected:` (`Parents`, `Requirement`, `Page`, `Endpoint`, `As`, `Design`, `Viewports`), in file order, with backticks removed. `actions`, `request` and `expected` are HTML from `renderMarkdown`, or `null` when the step has none.
  - A body with no `## Steps` returns `steps: []`.

- [ ] **Step 1: Write the failing tests** with a body built from `templates/runbook.md` (two filled steps, S01 with `Design:` and three actions, S02 with `Viewports: desktop` and no `Actions:`) and one from `templates/runbook-api.md` (`Endpoint:`, `As:`, `Request:`). Assert:
  - `sections.map((s) => s.heading)` equals `['Goal', 'Preconditions', 'Not covered', 'Cleanup']`, and drops `Not covered` when that section is missing;
  - S01 `fields` equals `[{ name: 'Parents', value: 'none' }, { name: 'Requirement', value: 'none' }, { name: 'Page', value: '/billing/invoices' }, { name: 'Design', value: 'invoices-list' }]` and `actions` starts with `<ol><li>`;
  - S02 `actions` is `null`;
  - the api step has `request` set and `fields` names `['Parents', 'Requirement', 'Endpoint', 'As']`;
  - `parseBody('# Title\n\nno sections')` equals `{ sections: [], steps: [] }`.

- [ ] **Step 2: Run** `node --test scripts/body.test.mjs`. Expected: FAIL.

- [ ] **Step 3: Implement** `parseBody`. Reuse the step heading pattern of `scripts/lib/junit.mjs` (`/^###\s+(S\d+)\.\s*(.*)$/`).

- [ ] **Step 4: Run** `node --test scripts/body.test.mjs`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(runbooks): parse runbook bodies into sections and steps`.

---

### Task 5: View models

**Files:**
- Create: `scripts/lib/project.mjs` (moved from `scripts/runbooks.mjs`)
- Create: `scripts/lib/explore.mjs`
- Create: `scripts/explore.test.mjs`
- Modify: `scripts/runbooks.mjs` (import the moved functions)

**Interfaces:**
- Consumes: `loadRunbooks`, `staleState`, `todayLocal` (Task 1), `listReports`, `reportByName` (Task 2), `renderMarkdown` (Task 3), `parseBody` (Task 4), `splitFrontmatter`.
- Produces in `project.mjs`, moved unchanged: `collect(root, config, listName, warnings, status?)`, `runbookWarnings(runbooks)`, `coverageResult(root, config, filters, warnings, withItems?)`.
- Produces in `explore.mjs`, each taking `(root, config, ..., { today })`:
  - `runbooksView(root, config, { today }) -> { staleDays, today, capabilities: Capability[] }` with `Capability = { name, problems, stale, uncovered: Array<{ id, kind, file }>, coverage: { covered, total } | null, runbooks: Row[] }` and `Row = { id, flow, title, status, surface, tags, date, time, age, stale, result, outdated, runs, problems }`. `flow` is the id after the dot. `date`/`time` come from `last_run` and the report name, as `outputRows` does today. `runs` is `listReports(...).length`. `uncovered` and `coverage` come from the slice with the capability's name (`null` coverage and `[]` uncovered when no slice has that name). `problems` (capability) = stale rows + uncovered entries. The list holds every capability folder, every coverage group name without a folder (a slice with no runbooks yet, `runbooks: []`), and `'(no slice)'` when that group exists, so every entry point belongs to exactly one item. Sorted by name, `'(no slice)'` last. This view collects entry points only and calls `computeCoverage` with `requirements: []` and `requirementsConfigured: false`, so it never runs a requirement `command` source.
  - `runbookView(root, config, id, { today }) -> { ...Row, feature, roles, viewports: Array<{ name, width, height }>, upstream, upstreamFromConfig: boolean, covers, scripts, sources, design, lastRun, path, body: { sections, steps }, stepStates: Record<string, Array<{ viewport: string | null, state: string }>>, warnings, problems } | null`. `stepStates` comes only from the report `last_run.report` names (its file name, read with `reportByName`), never from the newest local report; `{}` when there is none or it is missing. Add `reportOnDisk: boolean`, `false` when `last_run.report` is set but its file is not in `_runs/`. `null` for an unknown id.
  - `historyView(root, config, id) -> { id, runs: Array<{ name, date, commit, branch, mode, upstream, result, partial, counts }> } | null`.
  - `reportView(root, config, name) -> { name, runbook, date, commit, branch, mode, upstream, viewports, result, partial, steps, sectionsHtml: string } | null`. `sectionsHtml` renders the body after the `# Run` heading.
  - `coverageView(root, config, slice?: string) -> { slices: Array<{ name, covered, total }>, scope: string, result }`. Without `slice`, `result` is `coverageResult(root, config, {}, [], true)`; with one, it is the same object with `groups` and `entries.uncovered` filtered to that slice (`'(no slice)'` for the group without one). `slices` sums `covered` and `total` across the surfaces of each group name.

- [ ] **Step 1: Move** `collect`, `runbookWarnings` and `coverageResult` to `scripts/lib/project.mjs` and import them in `runbooks.mjs`. Run `npm test`. Expected: all pass, nothing else changed. Commit `refactor(runbooks): move coverageResult to lib/project.mjs`.

- [ ] **Step 2: Write the failing tests** against a copy of `scripts/__fixtures__/project` (and `scripts/__fixtures__/api` beside it, as `coverage.test.mjs` copies them), with `today: '2026-10-20'`:
  - `runbooksView` capabilities are `['billing', 'broken', 'deliveries', '(no slice)']`;
  - `(no slice)`: `runbooks: []`, `uncovered` ids `['/', '/settings']`, `problems` 2, `coverage` `{ covered: 0, total: 2 }`;
  - with a config slice `settings: ["src/app/[locale]/(dashboard)/settings/**"]` added, capabilities are `['billing', 'broken', 'deliveries', 'settings', '(no slice)']`, `settings` has `runbooks: []` and `uncovered` ids `['/settings']`, and `(no slice)` keeps only `['/']`;
  - the sum of every item's `coverage.total` equals the overall entry count (9);
  - billing: `problems` 2, `stale` 1 (`billing.cancel-invoice`, draft, never ran), `uncovered` ids `['GET /admin/invoices']`, `coverage` `{ covered: 2, total: 5 }`; the `billing.issue-invoice` row has `date: '2026-10-01'`, `time: '09:00'`, `age: 19`, `stale: false`, `runs: 1`;
  - deliveries: `deliveries.list-deliveries` has `age: 30`, `stale: false`, `outdated: true`; `deliveries.old-list` (deprecated) has `stale: false`; `problems` 1;
  - broken: `coverage: null`, the row has non-empty `problems`;
  - with `config.staleDays = 29`, `deliveries.list-deliveries` turns stale;
  - `runbookView(..., 'nope')` is `null`; `runbookView(..., 'billing.issue-invoice')` has `upstreamFromConfig: true` and `path: 'docs/runbooks/billing/issue-invoice.md'`;
  - after writing a report with a Viewport column and pointing `last_run.report` at it, `stepStates.S01` equals `[{ viewport: 'desktop', state: 'passed' }, { viewport: 'mobile', state: 'failed' }]`;
  - `deliveries.list-deliveries` (its `last_run.report` is not in the fixture `_runs/`) has `reportOnDisk: false` and `stepStates: {}`, even after a newer local full report for it is written;
  - `runbooksView` runs no requirement source: with a config whose `requirements` is `[{ extractor: 'command', command: 'exit 1' }]`, it returns without a warning about that source;
  - `historyView` lists the fixture report with `branch: null`; `reportView` of that report returns `sectionsHtml` without throwing;
  - `coverageView(root, config)` `slices` equals `[{ name: 'billing', covered: 2, total: 5 }, { name: 'deliveries', covered: 1, total: 2 }, { name: '(no slice)', covered: 0, total: 2 }]`; `coverageView(root, config, 'billing').result.entries.uncovered` ids equal `['GET /admin/invoices']`.

- [ ] **Step 3: Run** `node --test scripts/explore.test.mjs`. Expected: FAIL.

- [ ] **Step 4: Implement** `scripts/lib/explore.mjs`. Compute coverage once per call with `coverageResult(root, config, {}, [], true)` and take each capability's slice from its `groups`.

- [ ] **Step 5: Run** `npm test`. Expected: all pass.

- [ ] **Step 6: Commit** `feat(runbooks): build the UI view models from the files on disk`.

---

### Task 6: UI server and `runbooks.mjs ui`

**Files:**
- Create: `scripts/ui-server.mjs`
- Create: `scripts/ui-server.test.mjs`
- Modify: `scripts/runbooks.mjs` (`USAGE`, foreground `ui` branch beside `upstream`)

**Interfaces:**
- Consumes: `loadConfig`, the five view functions (Task 5), `todayLocal` (Task 1).
- Produces:
  - `createUiServer({ root: string, configPath?: string, today?: () => string, html?: () => string }) -> http.Server`. It calls `loadConfig` on every request, so config edits show on reload. `html` defaults to reading `templates/ui.html` on every request.
  - `serveUi({ root, configPath, port }) -> http.Server`: listens on `127.0.0.1:<port>`, prints `runbooks-ui listening on http://127.0.0.1:<port>`, exits 2 with `runbooks: port <port> is in use; stop what holds it or pass --port` on `EADDRINUSE`, stops on SIGINT and SIGTERM.
  - Routes, all `GET`:

| Route | Answer |
|---|---|
| `/` | `templates/ui.html`, `text/html; charset=utf-8` |
| `/api/runbooks` | `runbooksView` |
| `/api/runbook/<id>` | `runbookView`, 404 when `null` |
| `/api/runbook/<id>/runs` | `historyView`, 404 when `null` |
| `/api/runs/<name>` | `reportView`, 404 when `null` |
| `/api/coverage` and `/api/coverage?slice=<name>` | `coverageView` |

  - JSON answers use `application/json; charset=utf-8` and `cache-control: no-store`. A foreign `Host` gets 403 `{ "error": "forbidden host" }`. Any other method gets 405, any other path 404 `{ "error": "not found" }`. A `ConfigError` or any thrown error gets 500 `{ "error": <message> }`, so a broken config shows in the page.

- [ ] **Step 1: Write the failing tests**, starting the server on port 0 against a copy of the fixture project, as `upstream-server.test.mjs` `start()` does, with `today: () => '2026-10-20'` and `html: () => '<!doctype html><title>ui</title>'`:
  - `/api/runbooks` returns 200 and the billing capability with `problems: 2`;
  - `/api/runbook/billing.issue-invoice` 200; `/api/runbook/nope` 404;
  - `/api/runs/2026-10-01-0900-billing.issue-invoice.md` 200; `/api/runs/..%2Frunbooks.config.json` 404; `/api/runs/2026-10-01-0900-billing.nope.md` 404;
  - `/api/coverage?slice=billing` 200 with `scope: 'billing'`;
  - a request with `Host: evil.test` gets 403; the response has no `access-control-allow-origin` header;
  - `POST /api/runbooks` gets 405;
  - after a test writes a new runbook file into the copy, the next `/api/runbooks` lists it (no cache);
  - after a test writes `{ version: 2 }` as the config, `/api/runbooks` returns 500 with an `error` naming the version;
  - `cli.test.mjs`: spawning `runbooks.mjs ui --port <taken port> --root <fixture>` exits 2 with stderr matching `/port \d+ is in use/` (reuse how the upstream port test takes a port).

- [ ] **Step 2: Run** `node --test scripts/ui-server.test.mjs`. Expected: FAIL.

- [ ] **Step 3: Implement** `scripts/ui-server.mjs`. Decode each path segment with `decodeURIComponent` once and pass it to the view functions; the name check lives in `reportByName`. In `runbooks.mjs`, add a `ui` branch next to the `upstream` one: parse `--port` (default `4020`, integer 0 to 65535, else exit 2), `--root`, `--config`, then `serveUi`. Add to `USAGE`: `ui [--port n] starts the read-only UI server on 127.0.0.1 (default port 4020) in the foreground and prints its address; stop it with Ctrl+C`.

- [ ] **Step 4: Run** `npm test`. Expected: all pass.

- [ ] **Step 5: Commit** `feat(runbooks): serve the UI views from a local read-only server`.

---

### Task 7: The single page app

**Files:**
- Create: `templates/ui.html`

**Interfaces:**
- Consumes: the routes of Task 6 and the JSON shapes of Task 5. Fields named `html`, `actions`, `request`, `expected` and `sectionsHtml` are already escaped by `renderMarkdown` and are the only values set with `innerHTML`; every other value goes through `textContent`.

The page follows the spec sections "Visual design", "Runbooks page", "Runbook detail" and "Coverage page", and the mockups listed in the header of this plan.

- [ ] **Step 1: Write** `templates/ui.html`: one file with inline CSS and JS. A hash router renders one of four views into the container; the sidebar lists capabilities (Runbooks and runbook detail) or slices (Coverage). Rules the spec fixes:
  - header with `❯ runbooks` and the menu "Runbooks" / "Coverage", current one underlined in `--accent`;
  - sidebar counts: a capability's `problems` in red, `0` in grey; a slice's percentage in red below 50;
  - an item with `runbooks: []` shows "No runbooks yet" in place of the table; "all" stacks every item and its counters sum the items;
  - stale rows: background `color-mix(in srgb, var(--failed) 10%, transparent)`, `box-shadow: inset 3px 0 0 var(--failed)` on the first cell, date in `--failed`, "N days ago" below the date, "never run" when `age` is `null`. The stale counter label reads `no run in <staleDays>+ days`;
  - an `outdated` row shows the "outdated" badge with the title "The runbook changed after this run";
  - an invalid row shows an "invalid" badge and its `problems` as text;
  - runbook detail: breadcrumb, id, title, badges, tabs "Runbook" and "History (N)", metadata panel (the last run line says "report not on this machine" when `reportOnDisk` is `false`), `body.sections` in order with `Steps` between `Preconditions` and the rest, step cards with one badge per `stepStates` entry (`desktop passed`), a red border when any state is `failed`, no badge when the step has no state;
  - history: list newest first, "partial" mark, "N runs on this machine"; clicking a run sets `#/runbook/<id>/history/<name>` and opens the right panel from `/api/runs/<name>`; the close button returns to `#/runbook/<id>/history`;
  - coverage: overall sections as in today's `coverage.html` (counters, By slice with the covered/pending/planned bar, Uncovered with the filter, Orphans, Invalid runbooks); a slice shows its entries with state badge, runbooks and scripts, and "cited, not covered (mocked)" when `citedByMocked` is set; a slice whose name is a capability links to `#/runbooks/<name>`;
  - a fetch that answers non-200 shows its `error` text in the container instead of a blank page.

- [ ] **Step 2: Verify by hand.** From `runbooks/`, copy the fixture project and its `api` sibling to a temp folder and run `node scripts/runbooks.mjs ui --root <copy>/project --port 4020`. Open `http://127.0.0.1:4020/` and check, against the mockups: `billing.cancel-invoice` shows red and "never run"; "no slice" lists `/` and `/settings` with "No runbooks yet"; `deliveries.list-deliveries` shows "30 days ago", not red, with "outdated"; the History tab of `billing.issue-invoice` lists one run and its panel opens; Coverage "overall" shows 3 of 9 entry points; the billing slice lists `GET /admin/invoices` as uncovered; back and reload keep the view. Add a report with a Viewport column to the copy and check the step badges.

- [ ] **Step 3: Commit** `feat(runbooks): add the runbooks UI page`.

---

### Task 8: The `/runbooks:ui` command

**Files:**
- Create: `commands/ui.md`
- Modify: `README.md`, `skills/runbooks/SKILL.md`, `templates/readme.md` (command lists)
- Modify: `scripts/plugin.test.mjs` (command list)

- [ ] **Step 1: Update the test.** In `scripts/plugin.test.mjs`, rename "all twelve commands exist" to "all thirteen commands exist" and add `'ui'` to the expected list, after `'update'`. Run `npm test`. Expected: FAIL on the missing command and on the three docs that do not list it.

- [ ] **Step 2: Write** `commands/ui.md` with the frontmatter and sections of the other commands (`description`, `argument-hint: "[--port n]"`, `disable-model-invocation: true`, `## Parameters`). Steps:
  1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" ui $ARGUMENTS` with the Bash tool in the background, so it outlives the turn.
  2. Wait for the line `runbooks-ui listening on http://127.0.0.1:<port>` and give the user that URL as a link. Exit code 2: show the message; for a taken port, offer `--port`; for a missing config, offer `/runbooks:setup`.
  3. Say that the pages read the files on every reload, so runs and edits show without restarting, and that the history shows the runs of this machine only.
  4. The server stays up until the user asks to stop it or the session ends. To stop it, stop that background task.
  Done when the user has the URL.

- [ ] **Step 3: List the command** in the command tables of `README.md`, `skills/runbooks/SKILL.md` and `templates/readme.md`, one line each: "`/runbooks:ui`: open a local page with capabilities, runbooks, run history and coverage".

- [ ] **Step 4: Run** `npm test`. Expected: all pass.

- [ ] **Step 5: Commit** `feat(runbooks): add /runbooks:ui`.

---

### Task 9: Remove `output`, `runs.*` and `coverage.*`

**Files:**
- Delete: `scripts/lib/output.mjs`, `templates/runs.html`, `templates/coverage.html`
- Modify: `scripts/runbooks.mjs` (`USAGE`, `PROJECT_COMMANDS`, `commandOutput`, imports)
- Modify: `scripts/cli.test.mjs` (delete the two `output` tests)
- Modify: `commands/run.md`, `commands/coverage.md`, `commands/setup.md`, `skills/runbooks/references/commits.md`, `templates/readme.md`

- [ ] **Step 1: Write the failing test** in `cli.test.mjs`: `run(['output', '--root', FIXTURE])` returns code 2 with stderr `runbooks: unknown command "output"`, and `USAGE` does not match `/output/`. Delete the two `output` tests. Run `npm test`. Expected: the new test FAILS.

- [ ] **Step 2: Remove** `commandOutput`, `'output'` from `PROJECT_COMMANDS`, the `output` lines of `USAGE`, the `output.mjs` import, and delete the three files. Move `outputRows`'s date and time logic into `explore.mjs` if Task 5 imported it from `output.mjs`.

- [ ] **Step 3: Update the commands.**
  - `run.md`: delete the `output` paragraph (line 93), the closing link to `runs.html` (line 117), and "`runs.json` and `runs.html` are rewritten" from the Done line; replace "Reports and `runs.*` are not committed" with "Reports are not committed". End the command with: "End with a line that offers `/runbooks:ui` to see the results by capability."
  - `coverage.md`: delete step 5 and renumber; in step 7 replace the links with the `/runbooks:ui` offer, and say "`_coverage/` is ignored by Git" without the summary files; Done becomes "every scope has its report file and the chat summary lists the same numbers".
  - `commits.md`: replace the summary files paragraph and its migration list with: "Older versions wrote `runs.json`, `runs.html`, `coverage.json` and `coverage.html` in `<paths.runbooks>` and ignored them with `/<paths.runbooks>/runs.*` and `/<paths.runbooks>/coverage.*` in the root `.gitignore`. `setup` deletes the four files and the two lines."
  - `setup.md`: in the `.gitignore` row, keep only `.runbooks/`; in the migration list (beside the `_runs/output.*` item, line 120), add the deletion of the four files from disk and of the two `.gitignore` lines, both in the setup commit.
  - `templates/readme.md`: replace the two summary file lines with one line on `/runbooks:ui`.
  - `skills/runbooks/references/coverage.md` (line 14) and `docs/adr/0004-mocked-runbooks-never-cover-endpoints.md` (line 3): "in `coverage.html`" becomes "in `/runbooks:ui`".

- [ ] **Step 4: Check for leftovers.** Run `grep -rnE "runs\.(json|html)|coverage\.(json|html)|runbooks\.mjs\" output| output --coverage" runbooks --include='*.md' --include='*.mjs'` from the repo root. Expected: only the migration sentences in `commits.md` and `setup.md`.

- [ ] **Step 5: Run** `npm test`. Expected: all pass.

- [ ] **Step 6: Commit** `feat(runbooks)!: replace runs.html and coverage.html with /runbooks:ui`.

---

### Task 10: Version 1.3.0

**Files:**
- Modify: `.claude-plugin/plugin.json`, `scripts/upstream-server.mjs` (header comment and `VERSION`)

- [ ] **Step 1: Bump** both to `1.3.0`. `plugin.test.mjs` "the upstream server version equals the plugin version" guards the pair.

- [ ] **Step 2: Run** `npm test`. Expected: all pass.

- [ ] **Step 3: Commit** `chore(runbooks): bump to 1.3.0`.
