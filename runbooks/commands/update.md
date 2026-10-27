---
description: Update the steps of an existing runbook after the behavior it records changed
argument-hint: "<id> --from spec <path> | diff [base] | ticket <id> | text \"<description>\" | file <path> | dir <path> | route <url> [--model inline|haiku|sonnet|opus|fable]"
disable-model-invocation: true
---

# Update a runbook

Arguments: `$ARGUMENTS`

## Parameters

`<id>` and `--from` are both required; `--from` takes exactly one source.

| Parameter | Use |
|---|---|
| `<id>` | the runbook to update; `deprecated` runbooks are not updated |
| `--from spec <path>` | a spec or design doc describing the new behavior |
| `--from diff [base]` | the changes from `base` to `HEAD`; `base` defaults to `git.base` |
| `--from ticket <id>` | a tracker ticket, read as in `create` |
| `--from text "<description>"` | the change in your own words |
| `--from file <path>` | a code file that changed, read as in `create` |
| `--from dir <path>` | a code directory that changed, read as in `create` |
| `--from route <url>` | a frontend route or an API endpoint whose behavior changed, resolved to an entry as in `create` |
| `--model m` | force the model of the sub-agent this command launches: `inline` (the main session runs it), `haiku`, `sonnet`, `opus` or `fable` |

Examples: `/runbooks:update billing.issue-invoice --from diff`, `/runbooks:update billing.issue-invoice --from ticket CHE-612`, `/runbooks:update billing.issue-invoice --from text "the Issue button is now Generate invoice"`, `/runbooks:update billing.issue-invoice --from file "src/app/[locale]/(dashboard)/billing/invoices/page.tsx"`, `/runbooks:update billing.issue-invoice --from route "POST /admin/invoices"`.

This file only dispatches. The procedure is in `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/instructions/update.md`. Dispatching follows `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/agents.md`: read it before step 2. It covers the model, the brief, the report, questions, calls, commits and a model that cannot launch.

## Dispatch

1. Run `git status --porcelain` now and keep the list for the commit step.
2. Follow "Dispatch steps" in `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/agents.md` with the command `update` and the instructions file `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/instructions/update.md`. The brief carries the id and `--from` with its source as typed. The command asks nothing before the work: it asks about roles, reviews and the like while it works, and the main session relays each question.
3. A report with `status: call` asks for `/runbooks:run <id> --record`. Dispatch it by its own row as "Calls to other commands" in `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/agents.md` says, and send its report back. A command reached through a call never runs its own commit step. The main session commits once, in the dispatch file of the command the user typed, with every file the chain reported.
4. Print the `summary:` of the report as written, before any commit question.
5. **Commit.** Commit by the `runbooks` policy, staging by path the files the report lists in `files:`, with the fixtures changes in the same commit, and the config by the `setup` policy when the summary says step 5 added a viewport to it. Ask an `ask` question only after the table from step 4 is on screen; the question names the files and the message and does not repeat the table.
6. **Close.** Give the commit outcome: the short sha, or the paths left uncommitted. Then offer `/runbooks:run <id> --steps <unverified steps>` for a quick check, and say that only a full `/runbooks:run <id>` refreshes `status` and `last_run` and clears `outdated`. With role tracking on and `review` cleared, add that clearing it is not a run.

Done when the user has seen the table of changed steps before any commit question.
