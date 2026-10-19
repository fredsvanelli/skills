---
description: Run runbooks in the browser and record a report per runbook
argument-hint: "<id...> | --capability x | --affected [base] [--mode guided|headless|headed|chrome|prompt|script] [--steps S01,S02] [--import <file|text>]"
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
| `--mode m` | how the steps run: `guided` (you act and report), `headless` or `headed` (the agent through Playwright MCP), `chrome` (the agent through Claude in Chrome), `prompt` (a prompt for the Chrome extension), `script` (a temporary Playwright script). Without it, the command asks |
| `--steps S01,S02` | run only these steps. The report is marked partial, and `status` and `last_run` stay unchanged |
| `--import <file or text>` | bring back the reply of a `prompt` run, as a file path or pasted text, and write its report |

Examples: `/runbook:run billing.issue-invoice --mode headless`, `/runbook:run --affected --mode guided`, `/runbook:run billing.issue-invoice --steps S03,S04`, `/runbook:run billing.issue-invoice --import .runbook/reply.md`.

Read first: `${CLAUDE_PLUGIN_ROOT}/skills/runbook/references/format.md` (step states, dependency tree, status) and `${CLAUDE_PLUGIN_ROOT}/skills/runbook/references/run-modes.md` (the mode you will use).

Run `git status --porcelain` now and keep the list for the commit step.

## 1. Select

- Ids: those runbooks.
- `--capability x`: `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbook.mjs" list --capability x --json`.
- `--affected [base]`: `... list --affected [base] --json`.

Leave out `deprecated`, `placeholder` and invalid runbooks and name them in the final summary. A placeholder has no steps; offer `/runbook:create --from placeholder <id>` for it.

Mode: `--mode` when given; otherwise ask the user to choose among the available modes, as "Choosing the mode" in `run-modes.md` describes. With `--import`, go to step 6.

Run id per runbook: `<YYYY-MM-DD-HHMM>-<runbook id>`.

## 2. Check preconditions

- The app answers at `app.baseUrl` (`curl -s -o /dev/null -w '%{http_code}' <baseUrl>`). This reachability check is the only direct request allowed; it verifies nothing about a result. When the app is down, show the `app.start` commands and stop.
- Each account the runbooks' `roles` need has its env var names in `mcp.secretsFile`: `grep -c '^<NAME>=' <secretsFile>` prints a count, never a value. A missing name blocks the steps that log in as that role.
- In the browser, each precondition's data is visible. A missing precondition makes the steps that need it `blocked`, with the reason.

## 3. Order

Build each runbook's dependency tree from the `Parents:` lines and order the steps by the rules in `format.md`. With `--steps`, run only the listed steps, plus nothing else; a listed step whose parent is not in the list runs only when the user confirms the parent's state from the last report.

## 4. Execute

For each step in order:

1. A parent that is not `passed` makes the step `blocked-by-parent`; move on.
2. Perform the actions in the selected mode.
3. Compare the screen with Expected, record the state, what was seen (quoted on failure) and the evidence path.

Execute everything before fixing anything. A failure is a finding for the report.

## 5. Write the results

Per runbook:

1. Write `<paths.runbooks>/_runs/<run id>.md` from `${CLAUDE_PLUGIN_ROOT}/templates/run-report.md`. `result` is `failed` when any step failed, else `blocked` when any step is `blocked` or `blocked-by-parent`, else `passed`. `partial: true` with `--steps`.
2. Without `--steps`:
   - new status: `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbook.mjs" status --current <status> --states <comma-separated states>`; write it to the runbook's `status`;
   - `last_run: { date: <YYYY-MM-DD>, commit: "<short sha>", result: <result>, report: _runs/<run id>.md }`.
3. With `--steps`, leave `status` and `last_run` unchanged.

Then, once for the whole run, with or without `--steps`: `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbook.mjs" output`. It rewrites `<paths.runbooks>/_runs/output.json` and `output.html`: every runbook with the date and result of its last full run. Both are tracked by Git; when `git check-ignore -q <paths.runbooks>/_runs/output.json` succeeds (a `_runs/.gitignore` from an older setup), append `!output.json` and `!output.html` to `_runs/.gitignore`.

## 6. Import (prompt mode)

Parse the reply by the Import rules in `run-modes.md`, resolve every question with the user, then do step 5 with `mode: prompt`.

## 7. Show the results

Print the results in the conversation before any commit question:

- a table with one row per runbook: passed, failed, blocked, waived counts, the report path, and any status change;
- for each failure: step, Expected, Seen;
- the runbooks left out in step 1, with the reason.

## 8. Commit

Commit the runbook frontmatter changes (`status`, `last_run`), `_runs/output.json`, `_runs/output.html` and, when step 5 edited it, `_runs/.gitignore` by the `runbooks` policy. Reports are not committed: the rest of `_runs/` is ignored by Git, so they stay local. Ask an `ask` question only after the table from step 7 is on screen; the question names the files and the message and does not repeat the table.

## 9. Close

Give the commit outcome: the short sha, or the paths left uncommitted. Then offer to investigate the causes of the failures (with `superpowers:systematic-debugging` when available); the fix is separate work.

End with a link to the HTML table: `[output.html](file://<absolute path of <paths.runbooks>/_runs/output.html>)`.

Done when every selected runbook has a report, every step in it has a state, `output.json` and `output.html` are rewritten, and the user has seen the results table before any commit question.
