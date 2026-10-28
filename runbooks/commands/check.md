---
description: Show the result of a runbook's latest run, or say it was never run
argument-hint: "<id> [--full] [--model <model>]"
disable-model-invocation: true
---

# Check a runbook's latest run

Before following this procedure, read [runtime setup](../skills/runbooks/references/runtime.md). Resolve the plugin root from this file's real location and use the active host's tools and argument handling. Do this also when this entry is invoked directly.

Arguments: `$ARGUMENTS`

## Parameters

| Parameter | Use |
|---|---|
| `<id>` | required: the runbook whose latest run to show (`billing.issue-invoice`) |
| `--full` | skip partial runs (`--steps`) and show the newest full run |
| `--model m` | run this command in a sub-agent on that model: `inline` (the main session runs it, the default), `haiku`, `sonnet`, `opus` or `fable` on Claude; `inherit` or an available model ID on Codex |

Examples: `/runbooks:check billing.issue-invoice`, `/runbooks:check billing.issue-invoice --full`.

This command only reads. It opens no browser, writes no file and commits nothing.

By default the latest run is the newest report of the id, partial runs (`--steps`) included.

## Model

With `--model` set to a value other than `inline`, follow "Dispatch steps" in `${RUNBOOKS_PLUGIN_ROOT}/skills/runbooks/references/agents.md` with this file as the instructions file, and the sub-agent skips this section. Otherwise follow the file below as usual.

## Steps

1. Run `node "${RUNBOOKS_PLUGIN_ROOT}/scripts/runbooks.mjs" check $ARGUMENTS --json`.
   - Exit code 2 means the script could not run. Show its message: an unknown id gets the ids from `... list` that look closest; a missing config gets an offer of `/runbooks:setup`.
2. When `latest` is `null`:
   - and `lastRun` is `null` or holds no cells (`lastRun.cells` is empty, as in the old one-line `last_run`), say that the runbook has never been run, or, with `--full`, that it has never had a full run. When `lastRun.report` is set anyway, add that `last_run` cites a report that does not exist. Then offer `/runbooks:run <id>`. Stop.
   - and `lastRun.cells` is not empty, say that no report of the runbook is on this machine, name what `last_run` records (`lastRun.date`, `lastRun.result`, `lastRun.commit`), and go on with step 5. The cells still hold the state of every step that ran.
3. Otherwise read the report at `latest.path` and show:
   - the result, the date, the commit, the branch, the mode and the `upstream` mode (`live` or `mocked`), and whether the run was partial (`--steps`, `--role` or `--case`);
   - the count of steps per state, from `latest.counts`; with role tracking on, also per role, with `not-applicable` and `no-account` counts, and the roles without an account from the report;
   - when `latest.cases` is not empty, the counts per role and case, from the `role` and `case` of each entry in `latest.steps`, and the roles that ran once (case `*`);
   - the report's step table as it is written;
   - each failure with Expected and Seen, and each blocked step with what was missing, copied from the report's sections;
   - the report's Notes, shortened to the items that change how to read the result.
   - With role tracking on and a `review` entry in the runbook, say that its Expected may be out of date and offer `/runbooks:update <id>`. The latest run does not clear it.
4. When `latest` is set and `lastRunIsLatest` is `false`, the newest report is a partial run not merged into `last_run`, or a report the runbook's `last_run` does not cite. Say so, and name what `last_run` records (`lastRun.date`, `lastRun.result`, `lastRun.report`), or say there is none.
5. When `lastRun.cells` is not empty, list the cells, whatever `lastRunIsLatest` says. Right after a `--merge` run the newest report is the one `last_run` cites, and this step is where the user learns that other cells come from earlier runs.
   - When `lastRun.mixed` is `true`, say that the cells come from more than one run, name each entry of `lastRun.runs` with its date and report, and name the oldest date (`lastRun.oldest`).
   - List the pending cells (`pending`), the cells that failed or are blocked, and the outdated cells, each with its step, role, case and viewport.
6. When `lastRun.outdated` is `true`, say that `update` or `audit --fix` changed the runbook after the run, so the outdated cells verified the old text.
7. End with the report path and the next command that fits the result. After a failure or a block, offer `/runbooks:run <id>` once the cause is fixed. After a partial run, offer the same run again with `--merge` when its cells should enter `last_run`. When cells are pending or outdated, offer a run of those cells or a full run, because `status` moves only when no cell is pending or outdated.

Write in the config `language`.

Done when the user knows whether the runbook ran and, if it did, the result of its newest report.
