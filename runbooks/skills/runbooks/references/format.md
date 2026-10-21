# Runbook format

## Location and id

`<paths.runbooks>/<capability>/<flow>.md`, exactly one folder deep, kebab-case names. The id is `<capability>.<flow>`. Folders whose names start with `_` hold reports and are never runbooks.

## Frontmatter

```yaml
id: billing.issue-invoice
title: Issue a client invoice
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
calls: [GET /admin/internal/clients/{id}]
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
| `roles` | with role tracking off (config `roles.enabled` false): account roles from the config `accounts` that the steps log in as, and `all` is a problem. With tracking on: `all`, or a list of registered role names that run the runbook. `all` includes `anonymous`. A missing `roles` means `all`, and `create` writes `all` explicitly. A runbook that skips a role lists the roles it runs ("Roles" below) |
| `review` | tracking on only: a list of marks that the runbook's text may be wrong after a role change. Each entry holds a `reason`, a `date` and the fields of its reason ("Review" below). Missing means nothing to review |
| `viewports` | `ui` only: names from the config `viewports`, the screen sizes the steps run at, in run order. Missing or empty means the steps run once, at the browser's default size |
| `design` | `ui` only, and only when the config has `design`: a map from a screen name (kebab-case) to its design reference, a frame link or a file path (`config.md`, Design). `<name>.<viewport>` is the variant used at that viewport; without one, every viewport uses `<name>`. Steps cite the names in their `Design:` line |
| `upstream` | `ui` only: `live` or `mocked`, how the runbook reaches its upstream API. Written only when it differs from the config `upstream.mode` (`upstream.md`, "Modes"). A mocked runbook needs `upstream.urlEnv` in the config |
| `covers.entries` | entry ids exactly as `runbooks.mjs entries` prints them |
| `covers.requirements` | requirement ids exactly as `runbooks.mjs requirements` prints them, or ids from the source when no requirement source is configured |
| `calls` | `ui` only, and only when the config has `upstream`: the operations of an upstream API outside this repository that the screens reach, as `METHOD /path` with `{param}` segments, spelled as the API's OpenAPI document spells them when `upstream.schema` is set. Next.js segments (`[id]`, `[...path]`) are read as `{id}` and `{path}`. An endpoint that `runbooks.mjs entries` lists goes in `covers.entries` instead. `calls` never counts as coverage and never makes an orphan (`${CLAUDE_PLUGIN_ROOT}/docs/adr/0005-upstream-api-in-another-repo-is-a-contract.md`) |
| `sources` | spec paths, ticket ids, `diff <base>...<sha>`, `file <path>`, `dir <path>` and `route <entry id>` for code read as the source, `map <sha>` for a placeholder, and test files read as evidence only (tests of the code behind an entry, which cannot run the steps), that the runbook came from |
| `scripts` | the automated tests that run this runbook's steps, written or adopted by `to-test`. Optional for `ui`; required for `api`, whose runbook runs only through it. In a placeholder, the existing tests `map` fitted to the flow, which may cover it only in part: candidates `to-test` offers to adopt |
| `status` | `placeholder`, `draft`, `active` or `deprecated` (see Status) |
| `last_run` | the latest full run: `date`, `commit` (quoted), `result` (`passed`, `failed`, `blocked`), `report` (path relative to `paths.runbooks`), and `outdated: true` when `update` or `audit-runbooks --fix` changed the runbook after that run. The next full run writes `last_run` without it |

The parser reads a YAML subset: `key: value` maps nested by two-space indentation, lists as `[a, b]` or `- item` lines of scalars, inline maps `{ k: v }`, quoted strings, `#` comments after a space. Brackets inside an id stay part of it (`[/deliveries/[id], /x]` is two ids), and a flow list may continue over several lines until its `]`. Quote any value that starts with `[`, `{`, `"` or `'`, or that contains `, ` inside a flow list. Quote commit hashes so digits-only hashes stay strings.

## Body

Section headings stay in English so commands find them; text under them follows the config language.

```markdown
# <title>

---

## Goal

---

## Preconditions

---

## Steps

### S01. <what this step proves>

---

### S02. <what this step proves>

---

## Not covered

---

## Cleanup
```

A `---` line goes before every `##` heading and before every step heading except the first, which follows `## Steps` directly. Keep a blank line above and below each `---`: right under a line of text, Markdown reads it as a heading underline.

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
  - `As:` the role making the call, or `anonymous`. With role tracking on, role lines replace it (see "Roles" above and "As: during the migration").
  - `Request:` the body, query and headers that matter, with data named after the Preconditions.
  - `Expected:` the status and the body fields, plus the effects below.

Number steps `S01`, `S02`, and keep numbers stable: a removed step leaves a gap.

### Roles

With role tracking on, a runbook runs the same steps once per role, like viewports, and each step states what each role should see. The registry, its keys and its inheritance: `config.md`, "Roles".

- `roles` lists the roles that run the runbook, or `all` for every registered role, `anonymous` included. A role outside the registry is a problem.
- `Roles:` is an optional line on a step, like `Viewports:`. It limits the step to some of the runbook's roles (`Roles: editor, manager`). Missing means every role of the runbook. A role in `Roles:` that the runbook does not run is a problem.
- `Expected:` holds the result common to all roles. After it come one line per role whose behavior differs, each starting with the role name and an outcome keyword:

  ```markdown
  Expected: the list shows invoice "INV-001".
  - editor: read-only. The "Delete" button does not appear.
  - anonymous: denied. Redirects to /signin.
  ```

- A role line for a role that is not one of the step's roles is a problem. So is a keyword outside the table below.

| Outcome | Meaning |
|---|---|
| `allowed` | the common Expected applies. A role with no line is `allowed` |
| `read-only` | the role sees the screen and cannot act |
| `hidden` | the control or screen does not appear |
| `denied` | a 403 page, a redirect or an error |
| `partial` | the role acts with limits. The text after the keyword says which |

`api` steps use only `allowed`, `denied` and `partial`. On `api`, `denied` means 403 for a signed-in role and 401 for `anonymous`, and the line states the status and the body.

With role tracking off, role lines are plain text and no keyword is checked.

### Review

`review` says the runbook's text may be wrong and needs editing. It is separate from `last_run.outdated`, which says the runbook needs another run. Each entry has a `reason`, a `date` and the fields of that reason:

| Reason | Fields | Set when |
|---|---|---|
| `roles-enabled` | none | tracking was turned on, so every Expected needs its role lines |
| `role-permissions` | `role`, `key`, `change` | a permission of the role on the key changed. `change` is one line (`delete removed`) |
| `role-created` | `role` | a new role has no Expected lines yet |
| `role-deleted` | `role` | a deleted role's heirs lost permissions |

```yaml
roles: all
review:
  - { reason: roles-enabled, date: 2026-10-21 }
  - { reason: role-permissions, role: editor, key: billing/invoices, change: "delete removed", date: 2026-10-22 }
```

Only `update` of that runbook clears `review`, after the user confirms each role's Expected. A run does not clear it, because running old text proves nothing new. `run` still runs a runbook in review and warns before the first step. A runbook in review still counts as coverage. A runbook with tracking off and a `review` key has a problem.

### `As:` during the migration

`As:` is replaced by role lines. While a runbook's `review` holds `roles-enabled`, `As:` stays valid, and `update` turns each `As:` step into role lines. A runbook with no such review that still has `As:` gets a warning.

### What a step can verify

- `ui`: every expected result is observable in the browser. A behavior the UI does not show goes under "Not covered" with the reason. In a `mocked` runbook the step verifies what the screen shows and the request it sent (method, URL, body), never persistence. A step that would reload the page to check what the API saved checks that request instead, and persistence goes under "Not covered". The design comparison of a `Design:` line is a separate finding: it never changes the step's state.
- `api`, in this order of preference:
  1. the response: status, body fields, headers;
  2. persistence, through another call (`GET /invoices/{id}` after the POST), the API's own reload check;
  3. effects no endpoint shows (an e-mail, a queued job, a call to an external service), through the framework's fakes (`Mail::fake()`, `Queue::fake()`, a mocked HTTP client); as a last resort, the framework's own database assertion (`assertDatabaseHas`) inside the test database;
  4. what none of these reach (real delivery by the e-mail provider) goes under "Not covered" with the reason.

Items 3 and 4 live only in the script, in the project's isolated test environment. The agent itself still reads no database and writes no SQL.

An `api` runbook covers at least: the main path, invalid input (422 with the fields), and a read-back for anything it saves. With role tracking on, the 422 step and the read-back stay steps. The role that must not get in (403) and no authentication (401) are role lines on the main step: `denied` for a signed-in role and `denied` for `anonymous`, each with its status and body. Its Preconditions say how the script creates each piece of data (factory, seed, a call to another endpoint), and Cleanup names the isolation that undoes it (`RefreshDatabase`, a transaction per test).

### Preconditions and the upstream mode

The Data line of a `mocked` runbook points to its fixtures (`<upstream.fixtures>/<capability>/<flow>/`), which are its data. A `live` runbook states how each piece of data is created, and the data it creates carries the run suffix (`RUNBOOKS_RUN_ID`), so Expected quotes only the fixed part and Cleanup deletes what the run made. The rest: `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/upstream.md`.

### Flow

One runbook proves one flow. On `ui`: what a user does across screens to get one outcome. On `api`: one business operation, meaning a write plus the reads that prove its effect (`create-invoice`: `POST /invoices` and `GET /invoices/{id}`), or a read with logic of its own such as filters, pagination or scoping by role (`list-invoices`). One runbook per endpoint, or one per resource, is the wrong size.

### Scripts of api runbooks

One test per step, its name starting with the step id (`S01 admin creates a draft invoice`; `test_s01_...` or `testS01...` where names cannot have spaces). `runbooks.mjs junit` maps the JUnit report back to steps by that prefix.

With role tracking on, there is one test per step and role, named `S01 <title> as <role>`, and `S01 <title> as <role> @ <viewport>` for a `ui` script with viewports (the `@ <viewport>` part only with viewports). `junit` reads the step, the role and the viewport from the name. A role's test for a step whose parent ended `denied`, `hidden` or `read-only` for that role is not written, and `junit` reports that step as `not-applicable`. A `ui` role with no account gets no tests, and `junit` reports its steps as `no-account`.

Tests in the file without a prefix stay outside the runbook's result. The runbook is the source of truth: when a test's assertion and its step's Expected differ, the script changes, unless the user says the runbook is wrong. Why: `${CLAUDE_PLUGIN_ROOT}/docs/adr/0001-api-runbooks-run-through-their-script.md`.

## Dependency tree

A step depends on another when the parent's failure invalidates the child's result: the child uses state the parent creates, or checks something that exists only if the parent worked. Shared setup and convenient order are not dependencies.

- A step runs when all its parents are `passed`. On `api`, every test runs, and `runbooks.mjs junit` applies the parent rules to the results afterwards.
- A parent that is `failed`, `blocked` or `blocked-by-parent` makes the child `blocked-by-parent`, down the whole branch.
- Run order: every parent before its children. Among independent steps, keep the open screen, and leave steps that issue, cancel or delete data for last.
- The tree has no cycles.
- With `viewports`, the tree runs once per viewport, in the frontmatter order. Each step runs only at the viewports its `Viewports:` line allows, and its parents must run at each of them. A parent's state counts only for its children at the same viewport.
- With role tracking on, the tree runs once per role of the runbook, and inside each role once per viewport. Each step runs only for the roles its `Roles:` line allows. A parent's state counts only for its children of the same role and viewport.
- A parent that passes with the outcome `denied`, `hidden` or `read-only` for a role closes the branch for that role: its children are `not-applicable` for that role, because their action is not available either. The children still run for the roles whose parent was `allowed` or `partial`.

## Step states

Only run reports hold step states. With `viewports`, a step has one state per viewport it runs at. With role tracking on, it has one state per role too.

| State | Use when |
|---|---|
| `passed` | the expected result appeared |
| `failed` | something else appeared; record what was seen, quoting the screen |
| `blocked` | something outside the product is missing: data, an account, an integration; record what |
| `blocked-by-parent` | a parent is not `passed` in this run; the step is not executed |
| `waived` | the user chose to skip it; record the reason in their words. On `api`, only when asked before the run: the test still runs, and its outcome is ignored |
| `not-applicable` | role tracking on: a parent ended with `denied`, `hidden` or `read-only` for this role, so the step has nothing to do. It is neither a failure nor a block |
| `no-account` | role tracking on, `ui` only: the role has no entry in the config `accounts`, or its env var names are missing from `mcp.secretsFile`. Every step of that role's pass gets this state. The role stays in the runbook's `roles`. `anonymous` never gets it, and `api` runs never get it, because a script authenticates through the project's test helper |

## Placeholders

`map` writes one placeholder per flow no runbook cites, with its `surface` and the existing tests that fit the flow in `scripts`, from `${CLAUDE_PLUGIN_ROOT}/templates/placeholder.md`: full frontmatter with `status: placeholder`, a title, `# <title>`, a Goal, and a Steps section with no steps. `create` fills it in place, keeping its path and id. A placeholder is never run, scripted or listed by `--affected`.

## Status

- `map` writes `placeholder`. `create` writes `draft`, also when it fills a placeholder.
- A full run (no `--steps`, no `--role`) where every step ends `passed` or `waived`, at least one is `passed`, and none is in another state promotes `draft` to `active`. With `viewports`, this counts every state at every viewport. With role tracking on, it counts every role too, and `not-applicable` and `no-account` also allow the promotion. Compute it with `runbooks.mjs status`.
- The run `result` is `failed` when any step failed, else `blocked` when any step is `blocked` or `blocked-by-parent`, else `passed`. `not-applicable` and `no-account` count toward none of these.
- An `active` runbook that later fails stays `active`; `last_run` shows the failure.
- `deprecated` runbooks are listed but never count as coverage and never appear in `list --affected`.
- A runbook with frontmatter problems shows as `invalid` and never counts until fixed.
