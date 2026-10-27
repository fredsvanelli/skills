---
description: Write or adopt the test script of a runbook, in the project's test library for its surface
argument-hint: "<id> [--out path] [--model inline|haiku|sonnet|opus|fable]"
disable-model-invocation: true
---

# Runbook to test script

Arguments: `$ARGUMENTS`

## Parameters

| Parameter | Use |
|---|---|
| `<id>` | required: the runbook to script (`billing.issue-invoice`) |
| `--out path` | where to write a new script. Default: `<tests.<surface>.dir>/<capability>/<flow>.runbook.<ext>`, under `tests.<surface>.root` when it is set, with the extension and naming of the project's tests (`.spec.ts`, `.cy.ts`, `.test.ts`, `Test.php`) |
| `--model m` | force the model of the sub-agent this command launches: `inline` (the main session runs it), `haiku`, `sonnet`, `opus` or `fable` |

Examples: `/runbooks:to-test billing.issue-invoice`, `/runbooks:to-test billing.create-invoice --out tests/Feature/Runbooks/CreateInvoiceTest.php`.

This file only dispatches. The procedure is in `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/instructions/to-test.md`. Dispatching follows `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/agents.md`: read it before step 2. It covers the model, the brief, the report, questions, calls, commits and a model that cannot launch.

## Dispatch

1. Run `git status --porcelain` now and keep the list for the commit step, and `git -C <tests.ui.root> status --porcelain` too when `tests.ui.root` points to a UI tests repository.
2. Follow "Dispatch steps" in `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/agents.md` with the command `to-test` and the instructions file `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/instructions/to-test.md`. The brief carries the id and `--out` as typed. The command asks nothing before the work: the sub-agent reports the adopt-or-write choice and a divergence between a test and its step as questions, and the main session relays them.
3. Print the `summary:` of the report as written, before any commit question.
4. **Commit.** Commit the script and the runbook change together by the `runbooks` policy, staging by path the files the report lists in `files:`. When `tests.ui.root` points to a UI tests repository, the script gets a commit of its own there (`commits.md`, UI tests repository). Ask an `ask` question only after the summary from step 3 is on screen; the question names the files and the message and does not repeat the summary.
5. **Close.** Give the commit outcome: the short sha, or the paths left uncommitted.

Done when the user has seen the summary before any commit question.
