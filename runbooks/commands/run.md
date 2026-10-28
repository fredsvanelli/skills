---
description: Run runbooks (ui in the browser or through a per-step script, api through their test script), live or against fixtures, and record a report per runbook
argument-hint: "<id...> | --capability x | --affected [base] [--mode guided|headless|headed|chrome|prompt|script|test] [--steps S01,S02] [--role a,b] [--case a,b] [--record] [--import <file|text>] [--waive S03] [--model inline|haiku|sonnet|opus|fable]"
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
| `--affected [base]` | the runbooks `/runbooks:list --affected` returns; `base` defaults to `git.base` |
| `--mode m` | how the steps of `ui` runbooks run: `guided` (you act and report), `headless` or `headed` (the agent through Playwright MCP), `chrome` (the agent through Claude in Chrome), `prompt` (a prompt for the Chrome extension), `script` (a temporary Playwright script), `test` (the project's test command on a script with one test per step). Without it, the command asks. `api` runbooks always run through their test script |
| `--steps S01,S02` | run only these steps. The report is marked partial, and `status` and `last_run` stay unchanged unless `--merge` |
| `--role a,b` | role tracking on only: run only these roles of each runbook. Like `--steps`, it makes the report partial, and `status` and `last_run` stay unchanged unless `--merge`; `review` always stays. A role the runbook does not run is reported and skipped |
| `--case a,b` | runbooks with cases only: run only these cases of each runbook. It makes the report partial the same way as `--role`, and `--merge` applies the same way. A role that runs once builds the first selected case. A case the runbook does not run is reported and skipped |
| `--merge` | with `--steps`, `--role` or `--case`: write this run's cells into `last_run` and keep the others; `status` is recomputed. Alone, it is a full run: the command says so once and goes on. `review` stays as it is |
| `--record` | run the selection against the live upstream API with the upstream server in `record` mode, which saves each response as a fixture of the selected runbook and step (`upstream.md`, "Recording"). `create` and `update` call it for `mocked` `ui` runbooks |
| `--waive S03,S04` | `api` runbooks: steps to record as `waived`; their tests still run and their outcome is ignored. Ask for the reason before the run |
| `--import <file or text>` | bring back the reply of a `prompt` run, as a file path or pasted text, and write its report (with role tracking on, after the last role's import; step 6 of the instructions file) |
| `--model m` | force the model of every sub-agent this run launches: `inline` (the main session runs it), `haiku`, `sonnet`, `opus` or `fable`. It turns off escalation |

Examples: `/runbooks:run billing.issue-invoice --mode headless`, `/runbooks:run --affected --mode guided`, `/runbooks:run billing.issue-invoice --steps S03,S04`, `/runbooks:run billing.issue-invoice --role editor,viewer`, `/runbooks:run clients.edit-client --case vip-team,regular`, `/runbooks:run billing.issue-invoice --import .runbooks/reply.md`, `/runbooks:run billing.issue-invoice --record --mode headless`.

This file only dispatches. The procedure is in `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/instructions/run.md`. Dispatching follows `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/agents.md`: read it before step 5. It covers the model, the brief, the report, questions, calls, commits and a model that cannot launch.

## Dispatch

1. Run `git status --porcelain` now and keep the list for the commit step.
2. With `--import`, resolve the model with `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" model run --import reply [--model <x>]`, dispatch the Import step (step 6) of the instructions file by `agents.md`, and go to step 7.
3. Select, by the first match:
   - Ids: those runbooks.
   - `--capability x`: `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" list --capability x --json`.
   - `--affected [base]`: `... list --affected [base] --json`.

   Leave out `deprecated`, `placeholder` and invalid runbooks and name them in the final summary. A placeholder has no steps; offer `/runbooks:create --from placeholder <id>` for it.

   Split the selection by `surface` (in the `list --json` output). Mode for the `ui` runbooks: `--mode` when given; otherwise ask the user to choose among the available modes, as "Choosing the mode" in `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/run-modes.md` describes. Read only that section. Mode `test` is available for a `ui` runbook whose script has one test per step; the question says why it is not offered for the others. `--record` needs a browser mode (`guided`, `headless`, `headed` or `chrome`). With `--record` and mode `test`, `script` or `prompt`, say so and ask for a browser mode. When the selection has no `ui` runbook, ask nothing. With `--waive`, ask the reason for it now.
4. Group. An `api` runbook gets `--mode test`. A `ui` runbook gets the chosen mode. `--record`, `--steps`, `--role`, `--case`, `--waive` and `--model` carry as typed. Runbooks with the same arguments form one group. Resolve one model per group, passing every flag the user gave as typed (a value that is a list stands for itself, never free text), so a user row such as `run --steps` matches:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" model run --mode <m> [--record] [--steps S01] [--role a] [--case a] [--waive S03] [--model <x>] --json
   ```

   The output is `{ model, row, forced }`. Five `api` runbooks are one group. A `--mode headless` selection with `api` and `ui` runbooks is two groups.
5. Run the groups one after another, because the upstream server, the browser and the test database are shared. Give each runbook the run id `<YYYY-MM-DD-HHMM>-<runbook id>`. A group whose model is `inline` follows the instructions file in the main session. Any other group gets a sub-agent by `agents.md`, with the group's runbook ids, mode, flags and run ids in the brief, and `Forced model: yes` when `forced` is true. Put the `--waive` reason from step 3 in the brief. Relay each `status: question` and `status: call` report by `agents.md` until the group's sub-agent reports `done`, `blocked` or `failed`.

   The main session owns the upstream server for a `prompt` group and for `--import`, because a server started by a sub-agent may not outlive it. Before it dispatches or follows a `prompt` group, it starts the server by the start rule in step 2 of the instructions file (`upstream-copy` first and a stop on exit 1, then the copy it prints started in the background, wait for the first line, stop on a taken port). It keeps the server running across imports and stops it after the last runbook's import. The brief says the server is already up at its port and that the sub-agent must not start or stop it. In other modes the sub-agent starts and stops the server within its own run.
6. Escalate, only when `forced` is false. A report with `status: escalate` names a runbook and the reason (`sync` or `script`), and its `handoff:` names the runbooks of the group that did not run.
   - Resolve `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" model to-test <id>` and launch a sub-agent on that model with the `to-test` instructions file (`${CLAUDE_PLUGIN_ROOT}/skills/runbooks/instructions/to-test.md`). Tell it to write the missing tests, or to fix the named script mistake, without loosening an assertion.
   - Then launch a new sub-agent on the group's model to run that runbook and the ones in `handoff:`.
   - When that sub-agent reports `escalate` again for the same runbook, do not hand off a second time. Record the runbook as `blocked` in the results table with both reasons and offer `/runbooks:to-test <id>`. Launch another sub-agent on the group's model for the runbooks in that sub-agent's `handoff:`, then go on with the other groups.
   - Keep the rows of the runbooks each sub-agent finished before it escalated, and merge them with the rows of the later sub-agents.
7. Show the results. Print them in the conversation before any commit question, built from the `summary:` of every group:

   - a table with one row per runbook, as the summaries give it;
   - for each failure: step, role (with role tracking on), case (with cases), viewport, Expected, Seen;
   - for runbooks with design references: the count of `major` and `minor` differences, each `major` one with its step, viewport, and what the design and the page show, and the references not compared;
   - in mode `prompt`, the prompt files the summaries list (print their contents, or their paths) and the runbooks, roles and cases still waiting for an import;
   - the runbooks left out in step 3, with the reason;
   - for `api` runbooks: the scripts written or edited through `to-test`, the script mistakes fixed during the run, and the tests outside the runbook that failed.
8. Commit the runbook frontmatter changes (`status`, `last_run`, and `scripts` when `to-test` ran) by the `runbooks` policy, together with the script files `to-test` wrote or edited during this run. Reports are not committed: Git ignores them, so they stay local. Stage by path the runbook and script files the sub-agents listed in `files:`. Ask an `ask` question only after the table from step 7 is on screen; the question names the files and the message and does not repeat the table.
9. Close. Give the commit outcome: the short sha, or the paths left uncommitted. Then offer to investigate the causes of the failures (with `superpowers:systematic-debugging` when available), and to fix the `major` design differences; the fix is separate work.

   When the `stack` is `frontend` and the config sets `tests.ui`, name each runbook of this run that has an empty `scripts` and was fully approved: a run without `--steps`, `--role` or `--case`, with `result: passed` and no step `no-account`. Say that the best next step for it is a test script, written in a fresh context, and print the two commands to type, one runbook after the other:

   ```
   /clear
   /runbooks:to-test <id>
   ```

   End with a line that offers `/runbooks:ui` to see the results by capability.

Done when every selected runbook has a report, every step in it has a state, and the user has seen the results table before any commit question.
