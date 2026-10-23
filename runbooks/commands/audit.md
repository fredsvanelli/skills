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

Examples: `/runbooks:audit billing.issue-invoice`, `/runbooks:audit --capability billing`, `/runbooks:audit --all --fix`.

Read first: `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/format.md`, and for a `ui` runbook `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/upstream.md`.

With role tracking on (`roles.enabled` in the config), also read the Roles sections of `references/format.md` and `references/config.md`. The role checks below apply only then.

Run `git status --porcelain` now and keep the list for the commit step.

## 1. Select

`node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" list --json` filtered to the id, the capability, or every non-deprecated runbook with `--all`. Invalid runbooks get `broken` with their problems.

## 2. Check

Run `... coverage --json` once and read its `orphans`. When the config has an `upstream` block, also run `... contract --json` once and read its `findings` (`references/upstream.md`, Contract). Then, for each runbook, check every item below and record each finding with the step, the evidence (`file:line`) and the edit that would fix it:

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
| no step of a `mocked` runbook has an Expected that checks persistence after a reload or a value the API saved | `drift` |
| a `live` runbook has no fixtures folder, `<upstream.fixtures>/<capability>/<flow>/` | `drift` |
| every call matches an operation of `upstream.schema`, when it is set (a `call` finding of `contract`) | `drift` |
| every fixture of a `mocked` runbook is named by one of its `calls` or `covers.entries`, and the schema accepts it (a `fixture` finding of `contract`) | `drift` |
| every operation of an upstream API in another repository that the runbook's screens call, read from the code behind its `Page:` routes, is in its `calls`; and no `calls` item is one the screens no longer call | `drift` |

For the three rows on calls, the edit is the `calls` list to write, or the fixture to record again through `/runbooks:update`. A `call` finding can also mean the API removed or renamed the operation: say so, because then the screen needs a change, not the runbook. For the two upstream rows above them, the mode is the `upstream` field of the list output. A `mocked` runbook with such a step is stale, because a mocked run never reaches what the API saves. Its edit is to check the request instead (method, URL and body) and to list the persistence under "Not covered". A `live` runbook with a fixtures folder is stale, because the fixtures serve no run. Its edit is "delete `<dir>` or set `upstream: mocked` through `/runbooks:update`", with `<dir>` the folder (default `<paths.runbooks>/_fixtures/<capability>/<flow>`). A hand-edited `upstream:` that leaves the content incoherent shows up this way (`references/upstream.md`, Changing a runbook's mode).

`api` runbooks:

| Check | Verdict when it fails |
|---|---|
| every `Endpoint:` still exists, and its guards and middleware still let the `As:` role in (or still refuse it, on a 401 or 403 step) | `drift` |
| the fields in `Request:` and `Expected:` match the validation rules and the response shape in the code (form requests, DTOs, schemas, resources, serializers) | `drift` |
| `scripts` is not empty, unless the runbook is a placeholder | `drift`, suggesting `/runbooks:run <id>`, which writes it |
| every step has one test with its id in the script, and every runbook test asserts its step's Expected | `drift` |

With role tracking on, two more checks run:

Registry against code, once per audit, over the code the registry's `found` sources and the role signals of `setup` point at (role enums, guards, permission helpers, `accounts`). The role names and permissions come from `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" roles`:

| Check | Finding |
|---|---|
| a role the code defines that `roles.json` does not register | `role-missing` |
| a registered role whose `found` sources no longer show it. Never `anonymous`, which is built in and has no `found` sources | `role-gone` |

Runbooks against the matrix, for each runbook:

| Check | Finding |
|---|---|
| a role line that contradicts the role's `allowedActions` for the step's key (`allowed` where the action is missing, or `denied`, `hidden` or `read-only` where it is allowed) | `role-contradiction`, with the step, the role line and the matrix entry, marked `guess` when its origin is `guess` |
| on a runbook with cases, a role line that contradicts the role's actions in a case the line applies to: a line naming the case, or a line with no case in each case the step runs | `role-contradiction`, as above, with the case |
| on a runbook with cases, a role and case that lack the step's action and have no line that applies in that case | `role-contradiction`, with the step, the role, the case and the matrix entry |

Read a role's actions per case from `roles <name> --json`: the `cases` map of the key under `effective`. The audit does not scan the code for the condition behind a case, such as a team check or a VIP flag.

`role-missing` and `role-gone` belong to no runbook and are reported once. `role-contradiction` has the verdict `drift`, with or without a case; the two registry findings do not change a runbook's verdict.

The runbook's verdict is the worst of its findings; none means `in-sync`.

## 3. Report

A table (runbook, verdict, findings count), then the findings per runbook. Print it in the chat; write no file.

## 4. Fix (with `--fix`)

Show the proposed edits as a diff per runbook and apply them after the user approves. An edited runbook keeps its `status`. When its `last_run` is set and a fix changed a step, a precondition, `viewports` or `design`, add `outdated: true` to `last_run` and keep its other fields: the run verified the old text. A fix that touches only `sources`, `scripts` paths or a script file leaves `last_run` as it is. With role tracking on, `--fix` never edits `roles.json`, and it does not rewrite a role line against the matrix. A `role-missing` finding offers `/runbooks:roles:create`, a `role-gone` finding offers `/runbooks:roles:delete`, and a `role-contradiction` offers `/runbooks:update <id>` or `/runbooks:permissions:manage`, because the matrix or the runbook can be the wrong side. A script that no longer matches its runbook is fixed in the script, never by changing the runbook to match it. When the runbook looks like the wrong one, ask, and offer `/runbooks:update` for it.

## 5. Show the fixes (with `--fix`)

Print the summary in the conversation before any commit question: a table with one row per applied fix (runbook, step, finding, the edit in one line), then the findings left unfixed with the reason, and the runbooks whose `last_run` is now marked `outdated`.

## 6. Commit (with `--fix`)

Commit by the `runbooks` policy. Ask an `ask` question only after the summary from step 5 is on screen; the question names the files and the message and does not repeat the summary.

## 7. Close (with `--fix`)

Give the commit outcome: the short sha, or the paths left uncommitted. Offer `/runbooks:run <id>` for each edited runbook, and say that only a full run clears `outdated`.

Done when every selected runbook has a verdict and every finding names its evidence; with `--fix`, also when the user has seen the summary of the fixes before any commit question.
