# Runbook format

## Location and id

`<paths.runbooks>/<capability>/<flow>.md`, exactly one folder deep, kebab-case names. The id is `<capability>.<flow>`. Folders whose names start with `_` hold reports and are never runbooks.

## Frontmatter

```yaml
id: billing.issue-invoice
title: Issue a partner invoice
capability: billing
surface: ui
feature: invoices
tags: [financial, critical]
roles: [admin]
viewports: [desktop, mobile]
design:
  invoices-list: "https://www.figma.com/design/AbC123/Billing?node-id=12-34"
  invoices-list.mobile: "https://www.figma.com/design/AbC123/Billing?node-id=12-90"
  issue-dialog: "https://www.figma.com/design/AbC123/Billing?node-id=15-2"
covers:
  entries: ["/billing/invoices", "POST /admin/internal/invoices"]
  requirements: ["CHE-581#AC2"]
sources: ["docs/superpowers/specs/2026-09-18-CHE-581-design.md", "CHE-581"]
scripts: []
status: draft
last_run: { date: 2026-10-16, commit: "abc1234", result: passed, report: _runs/2026-10-16-1432-billing.issue-invoice.md }
```

| Key | Meaning |
|---|---|
| `id` | must equal `<capability>.<flow>` from the path |
| `title` | the user outcome, in the config language |
| `capability` | must equal the folder name; also the slice name used for coverage |
| `surface` | `ui` (verified in the browser) or `api` (verified by its script). Missing means `ui`. Must be a surface the config `stack` allows |
| `feature` | finer grouping inside a capability; free text |
| `tags` | free labels; `critical` marks the runbooks to run first |
| `roles` | account roles from the config `accounts` that the steps log in as |
| `viewports` | `ui` only: names from the config `viewports`, the screen sizes the steps run at, in run order. Missing or empty means the steps run once, at the browser's default size |
| `design` | `ui` only, and only when the config has `design`: a map from a screen name (kebab-case) to its design reference, a frame link or a file path (`config.md`, Design). `<name>.<viewport>` is the variant used at that viewport; without one, every viewport uses `<name>`. Steps cite the names in their `Design:` line |
| `upstream` | `ui` only: `live` or `mocked`, how the runbook reaches its upstream API. Written only when it differs from the config `upstream.mode` (`upstream.md`, "Modes"). A mocked runbook needs `upstream.urlEnv` in the config |
| `covers.entries` | entry ids exactly as `runbooks.mjs entries` prints them |
| `covers.requirements` | requirement ids exactly as `runbooks.mjs requirements` prints them, or ids from the source when no requirement source is configured |
| `sources` | spec paths, ticket ids, `diff <base>...<sha>`, `file <path>`, `dir <path>` and `route <entry id>` for code read as the source, `map <sha>` for a placeholder, and test files read as evidence only (tests of the code behind an entry, which cannot run the steps), that the runbook came from |
| `scripts` | the automated tests that run this runbook's steps, written or adopted by `to-test`. Optional for `ui`; required for `api`, whose runbook runs only through it. In a placeholder, the existing tests `map` fitted to the flow, which may cover it only in part: candidates `to-test` offers to adopt |
| `status` | `placeholder`, `draft`, `active` or `deprecated` (see Status) |
| `last_run` | the latest full run: `date`, `commit` (quoted), `result` (`passed`, `failed`, `blocked`), `report` (path relative to `paths.runbooks`), and `outdated: true` when `update` or `audit-runbooks --fix` changed the runbook after that run. The next full run writes `last_run` without it |

The parser reads a YAML subset: `key: value` maps nested by two-space indentation, lists as `[a, b]` or `- item` lines of scalars, inline maps `{ k: v }`, quoted strings, `#` comments after a space. Brackets inside an id stay part of it (`[/deliveries/[id], /x]` is two ids), and a flow list may continue over several lines until its `]`. Quote any value that starts with `[`, `{`, `"` or `'`, or that contains `, ` inside a flow list. Quote commit hashes so digits-only hashes stay strings.

## Body

Section headings stay in English so commands find them; text under them follows the config language.

```markdown
# <title>

## Goal
## Preconditions
## Steps
### S01. <what this step proves>
## Not covered
## Cleanup
```

Each step:

- `Parents:` the steps whose failure invalidates this one, or `none`.
- `Requirement:` the requirement id it verifies, or `none`.
- `ui` steps:
  - `Page:` the route the step starts on, as an entry id.
  - `Design:` optional, the name in `design` of the screen the step ends on. `run` compares that screen with its design.
  - `Viewports:` optional, the viewports the step runs at when it runs at only some of the runbook's: an action or an Expected that exists only at some sizes, such as a menu behind a button on mobile. Missing means every viewport of the runbook.
  - `Actions:` numbered, naming each control by its visible label.
  - `Expected:` the exact UI text and state. A persistence check reloads the page and states what remains.
- `api` steps:
  - `Endpoint:` the endpoint called, as an entry id (`POST /admin/internal/invoices`).
  - `As:` the role making the call, or `anonymous`.
  - `Request:` the body, query and headers that matter, with data named after the Preconditions.
  - `Expected:` the status and the body fields, plus the effects below.

Number steps `S01`, `S02`, and keep numbers stable: a removed step leaves a gap.

### What a step can verify

- `ui`: every expected result is observable in the browser. A behavior the UI does not show goes under "Not covered" with the reason. In a `mocked` runbook the step verifies what the screen shows and the request it sent (method, URL, body), never persistence. A step that would reload the page to check what the API saved checks that request instead, and persistence goes under "Not covered". The design comparison of a `Design:` line is a separate finding: it never changes the step's state.
- `api`, in this order of preference:
  1. the response: status, body fields, headers;
  2. persistence, through another call (`GET /invoices/{id}` after the POST), the API's own reload check;
  3. effects no endpoint shows (an e-mail, a queued job, a call to an external service), through the framework's fakes (`Mail::fake()`, `Queue::fake()`, a mocked HTTP client); as a last resort, the framework's own database assertion (`assertDatabaseHas`) inside the test database;
  4. what none of these reach (real delivery by the e-mail provider) goes under "Not covered" with the reason.

Items 3 and 4 live only in the script, in the project's isolated test environment. The agent itself still reads no database and writes no SQL.

An `api` runbook covers at least: the main path, invalid input (422 with the fields), a role that must not get in (403), no authentication (401), and a read-back for anything it saves. Its Preconditions say how the script creates each piece of data (factory, seed, a call to another endpoint), and Cleanup names the isolation that undoes it (`RefreshDatabase`, a transaction per test).

### Preconditions and the upstream mode

The Data line of a `mocked` runbook points to its fixtures (`<upstream.fixtures>/<capability>/<flow>/`), which are its data. A `live` runbook states how each piece of data is created, and the data it creates carries the run suffix (`RUNBOOKS_RUN_ID`), so Expected quotes only the fixed part and Cleanup deletes what the run made. The rest: `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/upstream.md`.

### Flow

One runbook proves one flow. On `ui`: what a user does across screens to get one outcome. On `api`: one business operation, meaning a write plus the reads that prove its effect (`create-invoice`: `POST /invoices` and `GET /invoices/{id}`), or a read with logic of its own such as filters, pagination or scoping by role (`list-invoices`). One runbook per endpoint, or one per resource, is the wrong size.

### Scripts of api runbooks

One test per step, its name starting with the step id (`S01 admin creates a draft invoice`; `test_s01_...` or `testS01...` where names cannot have spaces). `runbooks.mjs junit` maps the JUnit report back to steps by that prefix. Tests in the file without a prefix stay outside the runbook's result. The runbook is the source of truth: when a test's assertion and its step's Expected differ, the script changes, unless the user says the runbook is wrong. Why: `${CLAUDE_PLUGIN_ROOT}/docs/adr/0001-api-runbooks-run-through-their-script.md`.

## Dependency tree

A step depends on another when the parent's failure invalidates the child's result: the child uses state the parent creates, or checks something that exists only if the parent worked. Shared setup and convenient order are not dependencies.

- A step runs when all its parents are `passed`. On `api`, every test runs, and `runbooks.mjs junit` applies the parent rules to the results afterwards.
- A parent that is `failed`, `blocked` or `blocked-by-parent` makes the child `blocked-by-parent`, down the whole branch.
- Run order: every parent before its children. Among independent steps, keep the open screen, and leave steps that issue, cancel or delete data for last.
- The tree has no cycles.
- With `viewports`, the tree runs once per viewport, in the frontmatter order. Each step runs only at the viewports its `Viewports:` line allows, and its parents must run at each of them. A parent's state counts only for its children at the same viewport.

## Step states

Only run reports hold step states. With `viewports`, a step has one state per viewport it runs at.

| State | Use when |
|---|---|
| `passed` | the expected result appeared |
| `failed` | something else appeared; record what was seen, quoting the screen |
| `blocked` | something outside the product is missing: data, an account, an integration; record what |
| `blocked-by-parent` | a parent is not `passed` in this run; the step is not executed |
| `waived` | the user chose to skip it; record the reason in their words. On `api`, only when asked before the run: the test still runs, and its outcome is ignored |

## Placeholders

`map` writes one placeholder per flow no runbook cites, with its `surface` and the existing tests that fit the flow in `scripts`, from `${CLAUDE_PLUGIN_ROOT}/templates/placeholder.md`: full frontmatter with `status: placeholder`, a title, `# <title>`, a Goal, and a Steps section with no steps. `create` fills it in place, keeping its path and id. A placeholder is never run, scripted or listed by `--affected`.

## Status

- `map` writes `placeholder`. `create` writes `draft`, also when it fills a placeholder.
- A full run (no `--steps`) where every step ends `passed` or `waived`, at least one is `passed`, and none is in another state promotes `draft` to `active`. With `viewports`, this counts every state at every viewport. Compute it with `runbooks.mjs status`.
- An `active` runbook that later fails stays `active`; `last_run` shows the failure.
- `deprecated` runbooks are listed but never count as coverage and never appear in `list --affected`.
- A runbook with frontmatter problems shows as `invalid` and never counts until fixed.
