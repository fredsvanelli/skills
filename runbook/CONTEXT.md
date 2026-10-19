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
An automated test a runbook points to. It is optional for a `ui` runbook. For an `api` runbook it is required, because it is what runs the runbook. A placeholder's scripts are candidates: existing tests that cover its flow, possibly only in part, not yet adopted.
_Avoid_: spec, test file

**Covered**:
An entry or requirement that an `active` runbook cites. When the stack allows `api` runbooks, an endpoint counts as covered only through an `api` runbook. A `ui` runbook that cites it does not count.

**Stack**:
What a project exposes to runbooks: `frontend` (only `ui` runbooks), `backend` (only `api` runbooks) or `fullstack` (both).
_Avoid_: project type
