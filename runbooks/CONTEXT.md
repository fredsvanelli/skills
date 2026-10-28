# Runbook

A plugin that keeps a project's verified behavior as runbooks: versioned scripts for one flow, each with steps and the exact result expected after each one.

## Language

**Runbook**:
A versioned script for one flow, with preconditions, ordered steps and the exact expected result of each step. Its `roles` key names the roles that run it when role tracking is on.
_Avoid_: test case, scenario

**Flow**:
What a single runbook proves. On `ui`, it is what a user does across screens to get one outcome. On `api`, it is one business operation: a write plus the reads that prove its effect, or a read that has logic of its own (filters, scoping by role).
_Avoid_: endpoint, feature

**Surface**:
The layer a runbook verifies its results on: `ui` (what the browser shows) or `api` (what an endpoint returns). Every runbook has exactly one.
_Avoid_: kind, type, layer

**Script**:
An automated test a runbook points to. It is optional for a `ui` runbook, whatever its upstream mode. For an `api` runbook it is required, because it is what runs the runbook. A placeholder's scripts are candidates: existing tests that cover its flow, possibly only in part, not yet adopted.
_Avoid_: spec, test file

**Covered**:
An entry or requirement that an `active` runbook cites. When the stack allows `api` runbooks, an endpoint counts as covered only through an `api` runbook. A `ui` runbook that cites it does not count. A `mocked` `ui` runbook never covers an endpoint, whatever the stack.

**Viewport**:
A named screen size from the config (`desktop`, `mobile`) that a `ui` runbook runs at. The runbook's steps run once per viewport it cites, and each run has its own states. A breakpoint is the width where the project's layout changes; a viewport is the size a run uses, chosen inside one breakpoint range.
_Avoid_: device, resolution

**Role**:
A kind of user, registered in `roles.json` when role tracking is on. A run repeats the steps once per role, like a viewport, and each step states what each role should see. `anonymous` is the role with no session and is always registered.
_Avoid_: account, user type

**Permission**:
An action a role has on a `capability/feature` key of the registry. `view`, `create`, `edit` and `delete` are fixed, and the project may add others. A role inherits the permissions of its parents, and its own entry for a key replaces the inherited one.
_Avoid_: access, right

**Context**:
A named question about the record that changes what a role may do on some `capability/feature` keys, such as how the user relates to the client a record belongs to. It lists its keys and its cases.
_Avoid_: condition, scope, attribute, situation

**Case**:
One answer to a context, such as `vip-team` or `regular`. The cases of a context exclude each other. A role keeps one login across its cases, and a runbook on a key of the context runs once per case, as it runs once per role and per viewport.
_Avoid_: condition, scope, attribute, situation

**Outcome**:
The keyword that opens a role line under a step's Expected and says what that role gets. `allowed` means the common Expected applies. `read-only` means the role sees the screen and cannot act. `hidden` means the control or screen does not appear. `denied` means a 403 page, a redirect or an error. `partial` means the role acts with limits that the text after the keyword states. `api` steps use only `allowed`, `denied` and `partial`.
_Avoid_: result, verdict

**Review**:
A mark in a runbook's frontmatter that its text may be wrong after a role change, for example a new role or a changed permission. It differs from `last_run.outdated`, which says the runbook should run again; a run clears it on the cells it ran. Only `update` clears it, after the user confirms each role's Expected. A run does not clear it.
_Avoid_: stale, dirty

**Design reference**:
The design a `ui` screen should look like, in the project's design system (a Figma frame, a Claude Design design, an exported file). A runbook names its screens' references in `design`, and `run` reports each difference between a screen and its reference without changing the step's state: the Expected decides the state. Only a run in the browser compares a screen with its reference; a script never does.
_Avoid_: mockup, spec

**Scenario**:
One way through a flow's code that ends in one observable result: a happy path, an expected error the code returns on purpose, or an edge case the code handles in a branch of its own. `create` lists a flow's scenarios through the `scenarios` skill and writes one step per scenario the surface shows.
_Avoid_: case, path

**Stack**:
What a project exposes to runbooks: `frontend` (only `ui` runbooks), `backend` (only `api` runbooks) or `fullstack` (both).
_Avoid_: project type

**Upstream API**:
The API that the screens of a `ui` runbook call. It is not the `api` surface: a `ui` runbook only depends on it, and an `api` runbook is the one that verifies it. It may be a folder of the same repository or live in another repository, which then has its own runbooks install.
_Avoid_: backend, API, server

**Call**:
An operation of an upstream API in another repository that a `ui` runbook's screens reach, written `METHOD /path` in its `calls`. A call is never an entry: it does not count as coverage and never makes an orphan.
_Avoid_: dependency, endpoint reference

**Contract**:
The OpenAPI document an upstream API in another repository publishes, kept in the front as `upstream.schema`. It is the only thing the two repositories share.
_Avoid_: spec, interface

**UI tests repository**:
A repository of its own that holds the scripts of the app's `ui` runbooks, cloned next to the app's repository. The runbooks and their coverage stay in the app's repository, and only the scripts live there.
_Avoid_: e2e repository, tests repo, another repository

**Upstream mode**:
How a `ui` runbook reaches its upstream API: `live` (the real API, holding test data) or `mocked` (fixed responses served in its place). The project has a default and a runbook may override it. A `mocked` runbook runs in the browser like any `ui` runbook, and proves what the screen shows and sends, never what the API saves.
_Avoid_: backend mode, mock mode, fake API
