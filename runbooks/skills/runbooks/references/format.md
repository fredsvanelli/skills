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
last_run:
  date: 2026-10-16
  oldest: 2026-10-16
  commit: "abc1234"
  result: passed
  report: _runs/2026-10-16-1432-billing.issue-invoice.md
  runs:
    r1: { date: 2026-10-16, commit: "abc1234", report: _runs/2026-10-16-1432-billing.issue-invoice.md }
  cells:
    S01: passed r1
    S02: passed r1
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
| `cases` | tracking on, and only on a runbook whose `capability/feature` matches a key of a context (`config.md`, "Contexts"): `all`, or a list of cases of that context, the ones the runbook runs. A missing `cases` means `all`, and `create` writes `all` explicitly ("Contexts and cases" below) |
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
| `last_run` | the state of every cell and the run that proved it, in the shape of "last_run" below. `date`, `commit` and `report` (path relative to `paths.runbooks`) copy the newest run; `result` is `passed`, `failed`, `blocked` or `incomplete`. `outdated: true` when `update` or `audit --fix` changed the runbook after a run. A run clears `outdated` on the cells it ran, and the key goes away when no cell has it |

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
  - `As:` the role making the call, or `anonymous`. With role tracking on, role lines replace it (see "Roles" below and "As: during the migration").
  - `Request:` the request as an `http` code block: method, path and query, the headers that matter, and the JSON body, with data named after the Preconditions (see "Request and response of api steps").
  - `Expected:` the status, the body fields as a `json` code block, then the effects below (see "Request and response of api steps").

Number steps `S01`, `S02`, and keep numbers stable: a removed step leaves a gap.

### Roles

With role tracking on, a runbook runs the same steps once per role, like viewports, and each step states what each role should see. The registry, its keys and its inheritance: `config.md`, "Roles".

- `roles` lists the roles that run the runbook, or `all` for every registered role, `anonymous` included. An empty list (`roles: []`) or a role outside the registry is a problem.
- `Roles:` is an optional line on a step, like `Viewports:`. It limits the step to some of the runbook's roles (`Roles: editor, manager`). Missing means every role of the runbook. A role in `Roles:` that the runbook does not run is a problem.
- `Expected:` holds the result common to all roles. After it come one line per role whose behavior differs, each starting with the role name and an outcome keyword:

  ```markdown
  Expected: the list shows invoice "INV-001".
  - editor: read-only. The "Delete" button does not appear.
  - anonymous: denied. Redirects to /signin.
  ```

- A role line for a role that is not one of the step's roles is a problem. A bullet whose keyword is not in the table below (`- status: paid`) is plain Expected text, not a role line. Role lines end at the next field line, `---` line or heading, so bullets under Not covered and Cleanup are never role lines.

| Outcome | Meaning |
|---|---|
| `allowed` | the common Expected applies. A role with no line is `allowed` |
| `read-only` | the role sees the screen and cannot act |
| `hidden` | the control or screen does not appear |
| `denied` | a 403 page, a redirect or an error |
| `partial` | the role acts with limits. The text after the keyword says which |

`api` steps use only `allowed`, `denied` and `partial`. On `api`, `denied` means 403 for a signed-in role and 401 for `anonymous`, and the line states the status and the body.

With role tracking off, role lines are plain text and no keyword is checked.

### Contexts and cases

With role tracking on, a runbook whose `capability/feature` matches a key of a context (`config.md`, "Contexts") runs once per case, as it runs once per role and per viewport. Each step then states what each role gets in each case. That context is the runbook's context. A runbook that matches no key of a context has no cases, and nothing in this section applies to it. Why a case runs inside a role instead of being a role of its own: `${CLAUDE_PLUGIN_ROOT}/docs/adr/0006-a-case-is-a-run-dimension-inside-a-role.md`.

- `cases` lists the cases the runbook runs, or `all` for every case of its context.
- Preconditions say how to build the record of each case, under a `Cases:` list with one line per case of `cases`:

  ```markdown
  ## Preconditions

  - Account: each role's login from `accounts`.
  - Cases:
    - vip-team: client "ACME" with `vip: true`, the role's account added to its team.
    - vip-outside: client "Globex" with `vip: true`, the role's account not on its team.
    - regular: client "Initech" with `vip: false`.
  ```

  A `live` runbook builds this data with the run suffix. A `mocked` runbook gets it from its `+<case>` fixture folders (`upstream.md`, "Case layer"). An `api` script builds it in each test, with the project's factories.
- `Cases:` is an optional line on a step, like `Roles:` and `Viewports:`. It limits the step to some of the runbook's cases (`Cases: vip-team, regular`). Missing means every case of the runbook. A runbook with a `Cases:` line on any step runs every role once per case ("Roles that run once" below).
- A role line can name cases: `- <role> in <case>[, <case>...]: <outcome>. <text>`. A line with no case applies to every case the step runs. For one role and one case, the line with the case wins over the line without one. A case adds no outcome keyword.

  ```markdown
  ### S02. The manager edits the client

  Parents: S01
  Requirement: none
  Page: /clients/{id}
  Actions:
  1. Click "Edit".
  2. Change the phone to "555-0100" and click "Save".
  Expected: the page shows "Saved" and the phone "555-0100".
  - manager in vip-outside: read-only. The "Edit" button does not appear.
  - viewer: read-only. The "Edit" button does not appear.
  ```

  `manager` has no line for `vip-team` and `regular`, so it is `allowed` there. `viewer` has the same actions in every case, so one line covers all of them.

**Roles that run once.** A role runs once, not once per case, when its effective actions on the runbook's key are the same in every case of `cases`, no role line names that role with a case, and no step of the runbook has a `Cases:` line. Its pass builds the data of the first case of `cases`, and its states carry the case `*`. Under `run --case`, it builds the first case of `cases` that the run selected. `anonymous` usually runs once. Every other role runs once per case of `cases`. `runbooks.mjs passes <id>` lists the passes: role, case, the case whose data the pass builds, viewport and account.

Problems the loader reports:

- `cases needs role tracking (roles.enabled)`
- `cases needs a context: <capability>/<feature> belongs to no context`
- `cases must list at least one case, or be all`
- `case "<name>" is not a case of <context>`
- `case "<name>" appears twice in cases`
- `Preconditions: case "<name>" has no line under Cases:`
- `Preconditions: Cases: "<name>" is not one of the runbook's cases`
- `<step>: Cases: "<name>" is not one of the runbook's cases`
- `<step>: role line "<role> in <case>" names a case the step does not run`
- `<step>: role line "<role> in <case>": the runbook has no context`
- `<step>: two role lines for <role> in <case>`

### Review

`review` says the runbook's text may be wrong and needs editing. It is separate from `last_run.outdated`, which says the runbook needs another run. Each entry has a `reason`, a `date` and the fields of that reason:

| Reason | Fields | Set when |
|---|---|---|
| `roles-enabled` | none | tracking was turned on, so every Expected needs its role lines |
| `role-permissions` | `role`, `key`, `change`, and `case` when the change is in one case | a permission of the role on the key changed. `change` is one line (`delete removed`), and names the case when there is one (`vip-outside: edit removed`) |
| `role-created` | `role` | a new role has no Expected lines yet |
| `role-deleted` | `role` | a deleted role's heirs lost permissions |
| `context-created` | `context` | a context was added, or a key was added to one. The runbooks it now reaches run per case and need `cases`, the Preconditions `Cases:` list and case role lines |
| `case-created` | `case` | a case was added to a context. Its runbooks need its Preconditions line and its role lines |

```yaml
roles: all
review:
  - { reason: roles-enabled, date: 2026-10-21 }
  - { reason: role-permissions, role: editor, key: billing/invoices, change: "delete removed", date: 2026-10-22 }
  - { reason: case-created, case: vip-new, date: 2026-10-23 }
```

A renamed or deleted case, and a deleted context, mark nothing: `runbooks.mjs rename-case`, `delete-case` and `delete-context` rewrite the runbooks themselves. Deleting a case removes it from every `cases` list, `Cases:` line and role line, and deletes a role line left with no case.

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

An `api` runbook covers at least: the main path, invalid input (422 with the fields), a role that must not get in (403), no authentication (401), and a read-back for anything it saves. With role tracking on, the 403 and 401 cases become role lines on the main step instead of steps of their own: `denied` for a signed-in role and `denied` for `anonymous`, each with its status and body. The 422 step and the read-back stay steps. Its Preconditions say how the script creates each piece of data (factory, seed, a call to another endpoint), and Cleanup names the isolation that undoes it (`RefreshDatabase`, a transaction per test).

### Request and response of api steps

`Request:` stands alone on its line, followed by an `http` code block: the request line with the method, the path and the query string, then the headers that matter, a blank line and the JSON body. A value known only at run time goes in angle brackets and names its source in the Preconditions (`/invoices/<id of the draft invoice>`). Credentials stay out of the block: `As:` or the role lines name who calls, and the helper from the agents block signs the call. A body that is not JSON, such as a file upload, is a sentence after the block.

`Expected:` gives the status on its line (`Expected: 200.`), followed by a `json` code block with the body fields the step checks:

- A key left out is not checked.
- An array lists its items in the order the response returns them, and the script checks that order and the length. When only some items matter, or the order does not, a sentence after the block says so.
- A value in angle brackets is checked by its type or its source, not as text: `"<uuid>"`, `"<ISO 8601>"`, `"<integer>"`, `"<id of the draft invoice>"`. It is always a JSON string, so the block stays valid JSON.
- A response with no body (204) has no block.

The effects (a read-back call, a fake) and the role lines come after the block, as text. A role line that states a body puts its block under the line, indented. Lines inside a code block are never fields or role lines.

````markdown
Request:

```http
GET /quotes/airports?page=1&perPage=50&sortBy=name&sortOrder=asc
```

Expected: 200.

```json
{
  "meta": { "total": 3, "page": 1, "perPage": 50, "totalPages": 1 },
  "data": [
    { "id": "<uuid>", "iataCode": "MIA", "name": "Miami International", "createdAt": "<ISO 8601>" },
    { "id": "<uuid>", "iataCode": "GIG", "name": "Rio de Janeiro/Galeão", "createdAt": "<ISO 8601>" },
    { "id": "<uuid>", "iataCode": "GRU", "name": "São Paulo/Guarulhos", "createdAt": "<ISO 8601>" }
  ]
}
```

- viewer: denied. 403 with

  ```json
  { "message": "Forbidden" }
  ```
````

### Preconditions and the upstream mode

The Data line of a `mocked` runbook points to its fixtures (`<upstream.fixtures>/<capability>/<flow>/`), which are its data. Over a GraphQL API, each operation the page sends has its own fixture, named by `request.operationName`, so a precondition such as "the client belongs to no group" is the fixture of the operation that reads the groups (`upstream.md`, "GraphQL operations"). A `live` runbook states how each piece of data is created, and the data it creates carries the run suffix (`RUNBOOKS_RUN_ID`), so Expected quotes only the fixed part and Cleanup deletes what the run made. The rest: `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/upstream.md`.

### Flow

One runbook proves one flow. On `ui`: what a user does across screens to get one outcome. On `api`: one business operation, meaning a write plus the reads that prove its effect (`create-invoice`: `POST /invoices` and `GET /invoices/{id}`), or a read with logic of its own such as filters, pagination or scoping by role (`list-invoices`). One runbook per endpoint, or one per resource, is the wrong size.

### Scripts of api runbooks

One test per step, its name starting with the step id (`S01 admin creates a draft invoice`; `test_s01_...` or `testS01...` where names cannot have spaces). `runbooks.mjs junit` maps the JUnit report back to steps by that prefix.

With role tracking on, an `api` script has one test per step and role, named `S01 <title> as <role>`. A mocked `ui` script has one test per step, role and viewport, named `S01 <title> as <role> @ <viewport>` (the `@ <viewport>` part only with viewports). `junit` reads the step, the role and the viewport from the name. A live `ui` script has one test per role and viewport, named `<title> as <role> @ <viewport>`, holding one `test.step('S01 <title>')` per step, and mode `test` is not offered for it (`instructions/to-test.md`, item 5). With cases, the case follows the role: `S01 <title> as <role> in <case>` for `api`, `S01 <title> as <role> in <case> @ <viewport>` for mocked `ui`, and `<title> as <role> in <case> @ <viewport>` for live `ui`. A role that runs once has no `in <case>` part. `junit` reads the case from the name too, and gives the reason when a test fits no pass: `no " in <case>" suffix`, `<case> is not one of the runbook's cases`, `<role> runs once; drop " in <case>"`, or `<step> does not run in <case>`. A role's test for a step whose parent ended `denied`, `hidden` or `read-only` for that role is not written, and `junit` reports that step as `not-applicable`. A `ui` role with no entry in the config `accounts` gets no tests, and `junit` reports its steps as `no-account`. `junit` checks only `accounts`. A live run also gives `no-account` to a role whose env var names are missing from `mcp.secretsFile` (`run-modes.md`, "Roles").

Tests in the file without a prefix stay outside the runbook's result. The runbook is the source of truth: when a test's assertion and its step's Expected differ, the script changes, unless the user says the runbook is wrong. Why: `${CLAUDE_PLUGIN_ROOT}/docs/adr/0001-api-runbooks-run-through-their-script.md`.

## Dependency tree

A step depends on another when the parent's failure invalidates the child's result: the child uses state the parent creates, or checks something that exists only if the parent worked. Shared setup and convenient order are not dependencies.

- A step runs when all its parents are `passed`. On `api`, every test runs, and `runbooks.mjs junit` applies the parent rules to the results afterwards.
- A parent that is `failed`, `blocked` or `blocked-by-parent` makes the child `blocked-by-parent`, down the whole branch.
- Run order: every parent before its children. Among independent steps, keep the open screen, and leave steps that issue, cancel or delete data for last.
- The tree has no cycles.
- With `viewports`, the tree runs once per viewport, in the frontmatter order. Each step runs only at the viewports its `Viewports:` line allows, and its parents must run at each of them. A parent's state counts only for its children at the same viewport.
- With role tracking on, the tree runs once per role of the runbook, and inside each role once per viewport. Each step runs only for the roles its `Roles:` line allows. A parent's state counts only for its children of the same role and viewport.
- With cases, the tree runs once per role, inside each role once per case of its passes (once, under `*`, for a role that runs once), and inside each case once per viewport. Each step runs only in the cases its `Cases:` line allows. A parent's state counts only for its children of the same role, case and viewport.
- A parent that passes with the outcome `denied`, `hidden` or `read-only` for a role closes the branch for that role (with cases, for that role in that case, by the role line that applies there): its children are `not-applicable` for that role, because their action is not available either. A `not-applicable` parent makes its children `not-applicable` for that role too, all the way down the branch. A parent that is `failed`, `blocked` or `blocked-by-parent` still makes the child `blocked-by-parent`, and that rule wins when both apply. The children still run for the roles whose parent was `allowed` or `partial`.

## Step states

Only run reports hold step states. With `viewports`, a step has one state per viewport it runs at. With role tracking on, it has one state per role too. With cases, it has one state per role, case and viewport, and a role that runs once records its states under the case `*`.

| State | Use when |
|---|---|
| `passed` | the expected result appeared |
| `failed` | something else appeared; record what was seen, quoting the screen |
| `blocked` | something outside the product is missing: data, an account, an integration; record what. With cases, a case whose data cannot be built gives `blocked` to every step of that pass, with the reason |
| `blocked-by-parent` | a parent is not `passed` in this run; the step is not executed. With role tracking on, a `not-applicable` parent gives `not-applicable` instead |
| `waived` | the user chose to skip it; record the reason in their words. On `api`, only when asked before the run: the test still runs, and its outcome is ignored |
| `not-applicable` | role tracking on: a parent ended with `denied`, `hidden` or `read-only` for this role, or is `not-applicable` for it, so the step has nothing to do. It is neither a failure nor a block |
| `no-account` | role tracking on, `ui` only: the role has no entry in the config `accounts`, or its env var names are missing from `mcp.secretsFile`. Every step of that role's pass gets this state. The role stays in the runbook's `roles`. `anonymous` never gets it, and `api` runs never get it, because a script authenticates through the project's test helper |

## Placeholders

`map` writes one placeholder per flow no runbook cites, with its `surface` and the existing tests that fit the flow in `scripts`, from `${CLAUDE_PLUGIN_ROOT}/templates/placeholder.md`: full frontmatter with `status: placeholder`, a title, `# <title>`, a Goal, and a Steps section with no steps. `create` fills it in place, keeping its path and id. A placeholder is never run, scripted or listed by `--affected`.

## last_run

`last_run` holds one state per cell. A cell is a step, with a role when role tracking is on, a case when the runbook has cases, and a viewport when it has `viewports`. A step whose `Roles:`, `Cases:` or `Viewports:` line leaves a pass out has no cell for that pass.

```yaml
last_run:
  date: 2026-10-18
  oldest: 2026-10-16
  commit: "def5678"
  result: passed
  report: _runs/2026-10-18-0910-billing.issue-invoice.md
  mixed: true
  outdated: true
  runs:
    r1: { date: 2026-10-16, commit: "abc1234", report: _runs/2026-10-16-1432-billing.issue-invoice.md }
    r2: { date: 2026-10-18, commit: "def5678", report: _runs/2026-10-18-0910-billing.issue-invoice.md }
  cells:
    S01: { admin: passed r1 outdated, viewer: passed r1 outdated }
    S02: { admin: passed r2, viewer: passed r2 }
```

- `runs` lists each report that still owns a cell, keyed `r1`, `r2` and so on, oldest first. The keys are renumbered on every write.
- `cells` has one key per step. Its value maps a pass key to `<state> <run key>`, followed by `outdated` when the cell is outdated. The pass key is the role, then `/<case>` when the cell has a case, then `@<viewport>` when it has a viewport: `admin`, `admin/vip-team`, `admin/*@mobile`, `@mobile`. A cell with no role, case or viewport is written as the value itself: `S02: passed r2`. A pending cell is absent.
- `result` is `failed` when any cell failed, else `blocked` when any is `blocked` or `blocked-by-parent`, else `incomplete` when any cell is pending, else `passed`. `not-applicable`, `no-account` and `waived` count as passing.
- `mixed: true` when `runs` has more than one entry. It goes away when a full run rewrites every cell.
- `date`, `commit` and `report` copy the newest run. `oldest` is the date of the oldest run, and `stale` ages a runbook from it.
- `outdated: true` while any cell is outdated.
- A `no-account` row fills only a pending cell and never replaces a cell that ran.
- `runbooks.mjs last-run` writes the shape, `mark-outdated` sets `outdated`, and `rename-case` and `rename-role-cells` rename a case or role in the cells.
- The old one-line shape (`last_run: { date, commit, result, report }`, with `outdated: true` at most) is still read. The first write converts it, and the cells it did not hold stay pending.

## Status

- `map` writes `placeholder`. `create` writes `draft`, also when it fills a placeholder.
- A full run (no `--steps`, no `--role`, no `--case`), or a partial run with `--merge` that leaves no cell pending or outdated, where every step ends `passed` or `waived`, at least one is `passed`, and none is in another state promotes `draft` to `active`. With `viewports`, this counts every state at every viewport. With role tracking on, it counts every role too, and every case with cases, and `not-applicable` and `no-account` also allow the promotion. Compute it with `runbooks.mjs status`.
- The run `result` is `failed` when any step failed, else `blocked` when any step is `blocked` or `blocked-by-parent`, else `passed`. `not-applicable` and `no-account` count toward none of these. A partial run with `--merge` also moves `status`, but only when no cell is pending or outdated.
- An `active` runbook that later fails stays `active`; `last_run` shows the failure.
- `deprecated` runbooks are listed but never count as coverage and never appear in `list --affected`.
- A runbook with frontmatter problems shows as `invalid` and never counts until fixed.
