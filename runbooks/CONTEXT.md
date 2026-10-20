# Runbook

A plugin that keeps a project's verified behavior as runbooks: versioned scripts for one flow, each with steps and the exact result expected after each one.

## Language

**Runbook**:
A versioned script for one flow, with preconditions, ordered steps and the exact expected result of each step.
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
The API that the screens of a `ui` runbook call. It is not the `api` surface: a `ui` runbook only depends on it, and an `api` runbook is the one that verifies it.
_Avoid_: backend, API, server

**Upstream mode**:
How a `ui` runbook reaches its upstream API: `live` (the real API, holding test data) or `mocked` (fixed responses served in its place). The project has a default and a runbook may override it. A `mocked` runbook runs in the browser like any `ui` runbook, and proves what the screen shows and sends, never what the API saves.
_Avoid_: backend mode, mock mode, fake API
