---
description: Check that runbooks still match the code (no browser)
argument-hint: "<id> | --capability x | --all [--fix] [--model inline|haiku|sonnet|opus|fable]"
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
| `--model m` | force the model of the sub-agent this command launches: `inline` (the main session runs it), `haiku`, `sonnet`, `opus` or `fable` |

Examples: `/runbooks:audit billing.issue-invoice`, `/runbooks:audit --capability billing`, `/runbooks:audit --all --fix`.

This file only dispatches. The procedure is in `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/instructions/audit.md`. Dispatching follows `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/agents.md`: read it before step 2. It covers the model, the brief, the report, questions, calls, commits and a model that cannot launch.

## Dispatch

1. With `--fix`, run `git status --porcelain` now and keep the list for the commit step.
2. Follow "Dispatch steps" in `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/agents.md` with the command `audit` and the instructions file `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/instructions/audit.md`. The brief carries the selection and `--fix` as typed. `audit` and `audit --fix` are two rows of the model table, so resolve the model with the arguments as typed. The command asks nothing before the work.
3. With `--fix`, the sub-agent reports each diff as a `status: question` and writes nothing until the answer arrives. Relay it with `AskUserQuestion` (approve, change, skip) and send the answer back.
4. Print the `summary:` of the report as written: the verdict table and the findings, and with `--fix` the fixes. Without `--fix`, nothing is written and nothing is committed.
5. **Commit (with `--fix`).** Commit by the `runbooks` policy, staging by path the files the report lists in `files:`. Ask an `ask` question only after the summary from step 4 is on screen; the question names the files and the message and does not repeat the summary.
6. **Close (with `--fix`).** Give the commit outcome: the short sha, or the paths left uncommitted. Offer `/runbooks:run <id>` for each edited runbook, and say that a run clears `outdated` on the cells it ran, and `last_run.outdated` goes away when no cell has it.

Done when every selected runbook has a verdict; with `--fix`, also when the user has seen the summary of the fixes before any commit question.
