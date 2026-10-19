---
description: Run runbooks (ui in the browser, api through their test script) and record a report per runbook
argument-hint: "<id...> | --capability x | --affected [base] [--mode guided|headless|headed|chrome|prompt|script] [--steps S01,S02] [--import <file|text>] [--waive S03]"
disable-model-invocation: true
---

# Run runbooks

Arguments: `$ARGUMENTS`

## Parameters

Pick what to run with one of `<id...>`, `--capability` or `--affected`; the other parameters go with any of them.

| Parameter | Use |
|---|---|
| `<id...>` | one or more runbook ids, separated by spaces |
| `--capability x` | every runbook in the capability folder `x` |
| `--affected [base]` | the runbooks `/runbook:list --affected` returns; `base` defaults to `git.base` |
| `--mode m` | how the steps of `ui` runbooks run: `guided` (you act and report), `headless` or `headed` (the agent through Playwright MCP), `chrome` (the agent through Claude in Chrome), `prompt` (a prompt for the Chrome extension), `script` (a temporary Playwright script). Without it, the command asks. `api` runbooks always run through their test script |
| `--steps S01,S02` | run only these steps. The report is marked partial, and `status` and `last_run` stay unchanged |
| `--waive S03,S04` | `api` runbooks: steps to record as `waived`; their tests still run and their outcome is ignored. Ask for the reason before the run |
| `--import <file or text>` | bring back the reply of a `prompt` run, as a file path or pasted text, and write its report |

Examples: `/runbook:run billing.issue-invoice --mode headless`, `/runbook:run --affected --mode guided`, `/runbook:run billing.issue-invoice --steps S03,S04`, `/runbook:run billing.issue-invoice --import .runbook/reply.md`.

Read first: `${CLAUDE_PLUGIN_ROOT}/skills/runbook/references/format.md` (step states, dependency tree, status) and `${CLAUDE_PLUGIN_ROOT}/skills/runbook/references/run-modes.md` (the mode you will use).

Run `git status --porcelain` now and keep the list for the commit step.

## 1. Select

- Ids: those runbooks.
- `--capability x`: `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbook.mjs" list --capability x --json`.
- `--affected [base]`: `... list --affected [base] --json`.

Leave out `deprecated`, `placeholder` and invalid runbooks and name them in the final summary. A placeholder has no steps; offer `/runbook:create --from placeholder <id>` for it.

Split the selection by `surface` (in the `list --json` output). `ui` runbooks follow every step below. `api` runbooks run in mode `test`, by the "test" section of `run-modes.md`, and use steps 2 to 4 as that section says.

Mode for the `ui` runbooks: `--mode` when given; otherwise ask the user to choose among the available modes, as "Choosing the mode" in `run-modes.md` describes. When the selection has no `ui` runbook, ask nothing. With `--import`, go to step 6.

Run id per runbook: `<YYYY-MM-DD-HHMM>-<runbook id>`.

## 2. Check preconditions

For `api` runbooks: item 1 of "test" in `run-modes.md`, then item 2 (sync), which writes or completes the script through `to-test` when needed. The `ui` checks below do not apply to them.

For `ui` runbooks:

- The app answers at `app.baseUrl` (`curl -s -o /dev/null -w '%{http_code}' <baseUrl>`). This reachability check is the only direct request allowed; it verifies nothing about a result. When the app is down, show the `app.start` commands and stop.
- Each account the runbooks' `roles` need has its env var names in `mcp.secretsFile`: `grep -c '^<NAME>=' <secretsFile>` prints a count, never a value. A missing name blocks the steps that log in as that role.
- In the browser, each precondition's data is visible. A missing precondition makes the steps that need it `blocked`, with the reason.
- With design references and a mode that compares them (`run-modes.md`, Design): the `design.mcp` server's tools are loaded, or the Artifact tool for `claude-design`. When they are not, say before the first step that the design is not compared in this run, and why; the steps still run.

## 3. Order

Build each runbook's dependency tree from the `Parents:` lines and order the steps by the rules in `format.md`. A `ui` runbook with `viewports` runs that order once per viewport, in the frontmatter order, each pass holding the steps its `Viewports:` lines allow. Before every pass after the first, follow the runbook's Cleanup and check its preconditions again, because the previous pass used the data. With `--steps`, run only the listed steps, plus nothing else; a listed step whose parent is not in the list runs only when the user confirms the parent's state from the last report.

## 4. Execute

`api` runbooks: items 3 to 5 of "test" in `run-modes.md`. With `--steps`, run the whole script and keep only those steps from the `junit` output.

`ui` runbooks with `viewports`: before each pass, set the browser to the viewport's size as "Viewports" in `run-modes.md` says for the selected mode.

`ui` runbooks, for each step in order:

1. A parent that is not `passed` at the same viewport makes the step `blocked-by-parent`; move on.
2. Perform the actions in the selected mode.
3. Compare the screen with Expected, record the state, the viewport, what was seen (quoted on failure) and the evidence path.
4. With a `Design:` line, compare the screen with its design reference, as "Design" in `run-modes.md` says, and record the differences. They do not change the state.

Execute everything before fixing anything. A failure is a finding for the report.

## 5. Write the results

Per runbook:

1. Write `<paths.runbooks>/_runs/<run id>.md` from `${CLAUDE_PLUGIN_ROOT}/templates/run-report.md`. `result` is `failed` when any step failed, else `blocked` when any step is `blocked` or `blocked-by-parent`, else `passed`. `partial: true` with `--steps`.
2. Without `--steps`:
   - new status: `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbook.mjs" status --current <status> --states <comma-separated states>`, with the states of every viewport; write it to the runbook's `status`;
   - `last_run: { date: <YYYY-MM-DD>, commit: "<short sha>", result: <result>, report: _runs/<run id>.md }`, replacing the old value, so an `outdated: true` from `update` or `audit-runbook --fix` goes away.
3. With `--steps`, leave `status` and `last_run` unchanged, `outdated` included.

Then, once for the whole run, with or without `--steps`: `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbook.mjs" output`. It rewrites `<paths.runbooks>/runs.json` and `runs.html`: every runbook with the date, time and result of its last full run, and whether a later edit made it outdated. Keep them ignored by the rules in `${CLAUDE_PLUGIN_ROOT}/skills/runbook/references/commits.md`.

## 6. Import (prompt mode)

Parse the reply by the Import rules in `run-modes.md`, resolve every question with the user, then do step 5 with `mode: prompt`.

## 7. Show the results

Print the results in the conversation before any commit question:

- a table with one row per runbook: its viewports, passed, failed, blocked, waived counts over all of them, the report path, and any status change;
- for each failure: step, viewport, Expected, Seen;
- for runbooks with design references: the count of `major` and `minor` differences, each `major` one with its step, viewport, and what the design and the page show, and the references not compared;
- the runbooks left out in step 1, with the reason;
- for `api` runbooks: the scripts written or edited through `to-test`, the script mistakes fixed during the run, and the tests outside the runbook that failed.

## 8. Commit

Commit the runbook frontmatter changes (`status`, `last_run`, and `scripts` when `to-test` ran) by the `runbooks` policy, together with the script files `to-test` wrote or edited during this run, and with the migration files from `commits.md` when step 5 touched them. Reports and `runs.*` are not committed: Git ignores them, so they stay local. Ask an `ask` question only after the table from step 7 is on screen; the question names the files and the message and does not repeat the table.

## 9. Close

Give the commit outcome: the short sha, or the paths left uncommitted. Then offer to investigate the causes of the failures (with `superpowers:systematic-debugging` when available), and to fix the `major` design differences; the fix is separate work.

End with a link to the HTML table: `[runs.html](file://<absolute path of <paths.runbooks>/runs.html>)`.

Done when every selected runbook has a report, every step in it has a state, `runs.json` and `runs.html` are rewritten, and the user has seen the results table before any commit question.
