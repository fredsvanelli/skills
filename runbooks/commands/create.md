---
description: Write a new runbook from a spec, diff, ticket, description, code file, directory, route or placeholder
argument-hint: "--from spec <path> | diff [base] | ticket <id> | text \"<description>\" | file <path> | dir <path> | route <url> | placeholder <id> [--model <model>]"
disable-model-invocation: true
---

# Create a runbook

Before following this procedure, read [runtime setup](../skills/runbooks/references/runtime.md). Resolve the plugin root from this file's real location and use the active host's tools and argument handling. Do this also when this entry is invoked directly.

Arguments: `$ARGUMENTS`

## Parameters

`--from` is required and takes exactly one source.

| Parameter | Use |
|---|---|
| `--from spec <path>` | a spec or design doc in the repository |
| `--from diff [base]` | the changes from `base` to `HEAD`; `base` defaults to `git.base` |
| `--from ticket <id>` | a tracker ticket, read through a tracker MCP tool, else the config `tickets.fetch`, else pasted by the user |
| `--from text "<description>"` | a description of the flow in your own words |
| `--from file <path>` | a code file of the flow: a page, a component, a route handler, a controller, a service |
| `--from dir <path>` | a code directory, such as a feature folder; each flow found in it can become a runbook |
| `--from route <url>` | a frontend route (`/billing/invoices/42`, or a full URL of the app) or an API endpoint (`POST /admin/invoices`) |
| `--from placeholder <id>` | a placeholder written by `/runbooks:map`; this run fills that file |
| `--model m` | force the model of the sub-agent this command launches: `inline` (the main session runs it), `haiku`, `sonnet`, `opus` or `fable` on Claude; `inherit` or an available model ID on Codex |

Whatever the source, the command looks for a placeholder of the same flow and fills it instead of writing a new file.

Examples: `/runbooks:create --from spec docs/specs/billing.md`, `/runbooks:create --from diff develop`, `/runbooks:create --from ticket CHE-581`, `/runbooks:create --from text "partner downloads an invoice PDF"`, `/runbooks:create --from file "src/app/[locale]/(dashboard)/billing/invoices/page.tsx"`, `/runbooks:create --from dir src/features/billing`, `/runbooks:create --from route /billing/invoices/42`, `/runbooks:create --from route "POST /admin/invoices"`, `/runbooks:create --from placeholder billing.issue-invoice`.

This file only dispatches. The procedure is in `${RUNBOOKS_PLUGIN_ROOT}/skills/runbooks/instructions/create.md`. Dispatching follows `${RUNBOOKS_PLUGIN_ROOT}/skills/runbooks/references/agents.md`: read it before step 2. It covers the model, the brief, the report, questions, calls, commits and a model that cannot launch.

## Dispatch

1. Run `git status --porcelain` now and keep the list for the commit step.
2. Follow "Dispatch steps" in `${RUNBOOKS_PLUGIN_ROOT}/skills/runbooks/references/agents.md` with the command `create` and the instructions file `${RUNBOOKS_PLUGIN_ROOT}/skills/runbooks/instructions/create.md`. The brief carries `--from` and its source as typed. The command asks nothing before the work: it asks about viewports, roles, designs and the like while it works, and the main session relays each question.
3. A report with `status: call` asks for `/runbooks:update` (the source covers a runbook that exists) or for `/runbooks:run <id> --record`. Dispatch that command by its own row as "Calls to other commands" in `${RUNBOOKS_PLUGIN_ROOT}/skills/runbooks/references/agents.md` says, and send its report back. A command reached through a call never runs its own commit step. The main session commits once, in the dispatch file of the command the user typed, with every file the chain reported. When the sub-agent ends after a call to `/runbooks:update`, commit with the files of both reports.
4. Print the `summary:` of the report as written, before any commit question.
5. **Commit.** Commit by the `runbooks` policy, staging by path the files the report lists in `files:`, and the config by the `setup` policy when the summary says step 2 added a viewport to it. The fixtures go with the runbook, also when `upstream.fixtures` points outside `paths.runbooks`. Ask an `ask` question only after the summary from step 4 is on screen; the question names the files and the message and does not repeat the summary.
6. **Close.** Give the commit outcome: the short sha, or the paths left uncommitted. Say the runbook counts as coverage after its first clean full run, and offer `/runbooks:run <id>`. For a `mocked` runbook whose fixtures were not recorded, offer `/runbooks:run <id> --record` once `upstream.baseUrl` answers. For an `api` runbook, say that the run first writes its script, or adopts an existing test, through `/runbooks:to-test`.

Done when the user has seen the summary before any commit question.
