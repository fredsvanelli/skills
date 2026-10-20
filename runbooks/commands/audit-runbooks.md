---
description: Check that runbooks still match the code (no browser)
argument-hint: "<id> | --capability x | --all [--fix]"
disable-model-invocation: true
---

# Audit runbooks against the code

Arguments: `$ARGUMENTS`

## Parameters

Pick one of `<id>`, `--capability` or `--all`; `--fix` goes with any of them.

| Parameter | Use |
|---|---|
| `<id>` | audit one runbook (`billing.issue-invoice`) |
| `--capability x` | audit every runbook in the capability folder `x` |
| `--all` | audit every runbook that is not `deprecated` |
| `--fix` | after the report, show the edits as a diff and apply them once the user approves. Without it the command only reports and writes nothing |

Examples: `/runbooks:audit-runbooks billing.issue-invoice`, `/runbooks:audit-runbooks --capability billing`, `/runbooks:audit-runbooks --all --fix`.

Read first: `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/format.md`.

Run `git status --porcelain` now and keep the list for the commit step.

## 1. Select

`node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" list --json` filtered to the id, the capability, or every non-deprecated runbook with `--all`. Invalid runbooks get `broken` with their problems.

## 2. Check

Run `... coverage --json` once and read its `orphans`. Then, for each runbook, check every item below and record each finding with the step, the evidence (`file:line`) and the edit that would fix it:

| Check | Verdict when it fails |
|---|---|
| every `covers.entries` id exists (not in `orphans`) | `broken` |
| every `covers.requirements` id exists, when requirement sources are configured | `broken` |
| every `Parents:` names an existing step and the tree has no cycle | `broken` |
| every path in `sources` and `scripts` still exists | `drift` |

`ui` runbooks:

| Check | Verdict when it fails |
|---|---|
| every quoted Expected text exists in a `uiText` file; for text with interpolated values, its static part | `drift` |
| every `Page:` route still exists and the runbook's roles can still open it (route guards, navigation config) | `drift` |
| every control named in Actions still has that visible label | `drift` |
| every `Design:` line names a key of the runbook's `design` | `broken` |
| every file in `design` exists, and every frame link opens through the design server when it is loaded in this session | `drift` |
| every `Viewports:` line names viewports of the runbook, and each step's parents run at every viewport the step runs at | `broken` |
| every control named in Actions is visible at each viewport the step runs at (responsive classes such as `hidden md:flex`, media queries) | `drift` |

`api` runbooks:

| Check | Verdict when it fails |
|---|---|
| every `Endpoint:` still exists, and its guards and middleware still let the `As:` role in (or still refuse it, on a 401 or 403 step) | `drift` |
| the fields in `Request:` and `Expected:` match the validation rules and the response shape in the code (form requests, DTOs, schemas, resources, serializers) | `drift` |
| `scripts` is not empty, unless the runbook is a placeholder | `drift`, suggesting `/runbooks:run <id>`, which writes it |
| every step has one test with its id in the script, and every runbook test asserts its step's Expected | `drift` |

The runbook's verdict is the worst of its findings; none means `in-sync`.

## 3. Report

A table (runbook, verdict, findings count), then the findings per runbook. Print it in the chat; write no file.

## 4. Fix (with `--fix`)

Show the proposed edits as a diff per runbook and apply them after the user approves. An edited runbook keeps its `status`. When its `last_run` is set and a fix changed a step, a precondition, `viewports` or `design`, add `outdated: true` to `last_run` and keep its other fields: the run verified the old text. A fix that touches only `sources`, `scripts` paths or a script file leaves `last_run` as it is. A script that no longer matches its runbook is fixed in the script, never by changing the runbook to match it. When the runbook looks like the wrong one, ask, and offer `/runbooks:update` for it.

## 5. Show the fixes (with `--fix`)

Print the summary in the conversation before any commit question: a table with one row per applied fix (runbook, step, finding, the edit in one line), then the findings left unfixed with the reason, and the runbooks whose `last_run` is now marked `outdated`.

## 6. Commit (with `--fix`)

Commit by the `runbooks` policy. Ask an `ask` question only after the summary from step 5 is on screen; the question names the files and the message and does not repeat the summary.

## 7. Close (with `--fix`)

Give the commit outcome: the short sha, or the paths left uncommitted. Offer `/runbooks:run <id>` for each edited runbook, and say that only a full run clears `outdated`.

Done when every selected runbook has a verdict and every finding names its evidence; with `--fix`, also when the user has seen the summary of the fixes before any commit question.
