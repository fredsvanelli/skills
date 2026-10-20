---
description: Show the result of a runbook's latest run, or say it was never run
argument-hint: "<id> [--full]"
disable-model-invocation: true
---

# Check a runbook's latest run

Arguments: `$ARGUMENTS`

## Parameters

| Parameter | Use |
|---|---|
| `<id>` | required: the runbook whose latest run to show (`billing.issue-invoice`) |
| `--full` | skip partial runs (`--steps`) and show the newest full run, the one `last_run` records |

Examples: `/runbooks:check billing.issue-invoice`, `/runbooks:check billing.issue-invoice --full`.

This command only reads. It opens no browser, writes no file and commits nothing.

By default the latest run is the newest report of the id, partial runs (`--steps`) included.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" check $ARGUMENTS --json`.
   - Exit code 2 means the script could not run. Show its message: an unknown id gets the ids from `... list` that look closest; a missing config gets an offer of `/runbooks:setup`.
2. When `latest` is `null`, say that the runbook has never been run, or, with `--full`, that it has never had a full run. When `lastRun.report` is set anyway, add that `last_run` cites a report that does not exist. Then offer `/runbooks:run <id>`. Stop.
3. Otherwise read the report at `latest.path` and show:
   - the result, the date, the commit, the branch and the mode, and whether the run was partial (`--steps`);
   - the count of steps per state, from `latest.counts`;
   - the report's step table as it is written;
   - each failure with Expected and Seen, and each blocked step with what was missing, copied from the report's sections;
   - the report's Notes, shortened to the items that change how to read the result.
4. When `lastRunIsLatest` is `false`, the newest report is a partial run, or a report the runbook's `last_run` does not cite. Say so, and name the full run that `last_run` records (`lastRun.date`, `lastRun.result`, `lastRun.report`), or say there is none.
5. When `lastRun.outdated` is `true`, say that `update` or `audit-runbooks --fix` changed the runbook after its last full run, so that run verified the old text.
6. End with the report path and the next command that fits the result. After a failure or a block, offer `/runbooks:run <id>` once the cause is fixed. After a partial run, or when `last_run` is outdated, offer a full run, because only a full run moves `status` and `last_run`.

Write in the config `language`.

Done when the user knows whether the runbook ran and, if it did, the result of its newest report.
