---
description: Run runbooks (ui in the browser or through a per-step script, api through their test script), live or against fixtures, and record a report per runbook
argument-hint: "<id...> | --capability x | --affected [base] [--mode guided|headless|headed|chrome|prompt|script|test] [--steps S01,S02] [--role a,b] [--record] [--import <file|text>] [--waive S03]"
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
| `--steps S01,S02` | run only these steps. The report is marked partial, and `status` and `last_run` stay unchanged |
| `--role a,b` | role tracking on only: run only these roles of each runbook. Like `--steps`, it makes the report partial, and `status`, `last_run` and `review` stay unchanged. A role the runbook does not run is reported and skipped |
| `--record` | run the selection against the live upstream API with the upstream server in `record` mode, which saves each response as a fixture of the selected runbook and step (`upstream.md`, "Recording"). `create` and `update` call it for `mocked` `ui` runbooks |
| `--waive S03,S04` | `api` runbooks: steps to record as `waived`; their tests still run and their outcome is ignored. Ask for the reason before the run |
| `--import <file or text>` | bring back the reply of a `prompt` run, as a file path or pasted text, and write its report (with role tracking on, after the last role's import; step 6) |

Examples: `/runbooks:run billing.issue-invoice --mode headless`, `/runbooks:run --affected --mode guided`, `/runbooks:run billing.issue-invoice --steps S03,S04`, `/runbooks:run billing.issue-invoice --role editor,viewer`, `/runbooks:run billing.issue-invoice --import .runbooks/reply.md`, `/runbooks:run billing.issue-invoice --record --mode headless`.

Read first: `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/format.md` (step states, dependency tree, status) and `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/run-modes.md` (the mode you will use). For a `ui` runbook, also `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/upstream.md` (the upstream modes, the server and its control routes). With role tracking on (`roles.enabled` in the config), also the Roles sections of `run-modes.md` and `format.md`. The role steps below apply only then.

Run `git status --porcelain` now and keep the list for the commit step.

## 1. Select

- Ids: those runbooks.
- `--capability x`: `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" list --capability x --json`.
- `--affected [base]`: `... list --affected [base] --json`.

Leave out `deprecated`, `placeholder` and invalid runbooks and name them in the final summary. A placeholder has no steps; offer `/runbooks:create --from placeholder <id>` for it.

Split the selection by `surface` (in the `list --json` output). `ui` runbooks follow every step below, except that one run in mode `test` follows the "test" section of `run-modes.md` for its execution, as `api` runbooks do. `api` runbooks run in mode `test`, by that section, and use steps 2 to 4 as it says.

Mode for the `ui` runbooks: `--mode` when given; otherwise ask the user to choose among the available modes, as "Choosing the mode" in `run-modes.md` describes. Mode `test` is available for a `ui` runbook whose script has one test per step; the question says why it is not offered for the others. `--record` needs a browser mode (`guided`, `headless`, `headed` or `chrome`). A script selects `mocked` and overrides `record`. A prompt run is not read until the import, and the server must stay up for it. With `--record` and mode `test`, `script` or `prompt`, say so and ask for a browser mode. When the selection has no `ui` runbook, ask nothing. With `--import`, go to step 6.

Run id per runbook: `<YYYY-MM-DD-HHMM>-<runbook id>`.

## 2. Check preconditions

For `api` runbooks: item 1 of "test" in `run-modes.md`, then item 2 (sync), which writes or completes the script through `to-test` when needed. The `ui` checks below do not apply to them.

For `ui` runbooks:

- The app answers at `app.baseUrl` (`curl -s -o /dev/null -w '%{http_code}' <baseUrl>`). This reachability check is the only direct request allowed besides the upstream checks below; it verifies nothing about a result. When the app is down, show the `app.start` commands and stop.
- The upstream server runs when the project has any `mocked` runbook (`list --json`, field `upstream`, over all runbooks and not only the selection) or the run has `--record`. The app then points at the server for live runbooks too, because the server proxies them in `live` mode. Start it in the background with `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" upstream` and wait for its first line, `runbooks-upstream listening on http://127.0.0.1:<port>`. A taken port exits 2 with a message naming the port and `upstream.port`: show it and stop. Stop the server when the run ends, except after a `prompt` run: the user runs the prompts later, so the server keeps running until the `--import` of the run's last runbook (step 6) has read it.
- When the upstream server runs, in `guided`, `headless`, `headed` and `chrome`, the app reaches the server. Select the first runbook (`POST /__runbooks/select`, step 4 says how), navigate once to its first page in the browser, then read `GET /__runbooks/state`. Zero `requests` means the app points elsewhere: show `<urlEnv>=http://127.0.0.1:<port> <app.start>` and stop. `script` checks this where it reads its results (`run-modes.md`, "script"), and `prompt` at the import (step 6). Mode `test` does not check it (`run-modes.md`, "test", item 3).
- When the config sets `upstream.baseUrl` and the selection has a `live` runbook, `upstream.baseUrl` answers (one `curl` as above). When it does not, show `upstream.start` and stop. With `--record`, the same check applies to every selected runbook.
- With `upstream.schema` set, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" fixtures <id>` for each `mocked` runbook before its first step. The command exits 0 with problems in its findings. Problems make the runbook `blocked`, not `failed`, with the problems as the reason; offer `/runbooks:to-test <id>` and `/runbooks:update <id>`. Skip the check for a runbook being recorded: the run is about to record or change its fixtures, so checking the old ones first would block it for nothing.
- Each account the runbooks' `roles` need has its env var names in `mcp.secretsFile`: `grep -c '^<NAME>=' <secretsFile>` prints a count, never a value. With role tracking off, a missing name blocks the steps that log in as that role. With role tracking on, a `ui` role with no `accounts` entry, or whose names are missing, is not blocked. Its whole pass gets `no-account` (`run-modes.md`, Roles). `anonymous` needs no account.
- With role tracking on, before the first step: list the roles of each `ui` runbook that get `no-account`, and warn for each runbook with a `review` entry that its Expected may be out of date (`format.md`, Review). The run goes on, and a run does not clear `review`.
- In the browser, each precondition's data is visible. A missing precondition makes the steps that need it `blocked`, with the reason.
- With design references and a mode that compares them (`run-modes.md`, Design): the `design.mcp` server's tools are loaded, or the Artifact tool for `claude-design`. When they are not, say before the first step that the design is not compared in this run, and why; the steps still run.

## 3. Order

Build each runbook's dependency tree from the `Parents:` lines and order the steps by the rules in `format.md`. A `ui` runbook with `viewports` runs that order once per viewport, in the frontmatter order, each pass holding the steps its `Viewports:` lines allow. With role tracking on, the passes are role outer and viewport inner: all viewports of the first role, then all viewports of the next, each pass holding the steps its `Roles:` and `Viewports:` lines allow. `--role` keeps only the listed roles. Before every pass after the first, follow the runbook's Cleanup and check its preconditions again, because the previous pass used the data. With `--steps`, run only the listed steps, plus nothing else; a listed step whose parent is not in the list runs only when the user confirms the parent's state from the last report.

## 4. Execute

`api` runbooks, and `ui` runbooks in mode `test`: items 3 to 5 of "test" in `run-modes.md`. With `--steps`, run the whole script and keep only those steps from the `junit` output.

`ui` runbooks with `viewports`: before each pass, set the browser to the viewport's size as "Viewports" in `run-modes.md` says for the selected mode.

`ui` runbooks, before each runbook, when the upstream server runs: `POST /__runbooks/select` with `{ runbook: "<id>", mode }`, where `mode` is `record` with `--record`, else the runbook's `upstream` (`mocked` or `live`). A new runbook resets the step and clears the request log. With role tracking on, a mocked runbook also gets the role selected before each pass (see below). The agent sends every select with `curl` and `-H 'content-type: application/json'` (`upstream.md`, "Control routes"). In mode `test`, the script selects the runbook and the step itself in `beforeEach`, and the agent selects nothing. In `script` mode the generated script selects each step, and in `prompt` mode the agent selects one runbook at a time, as "prompt" in `run-modes.md` says.

`ui` runbooks with role tracking on, before each role's pass:

- Log out and log in as the role with its `accounts` entry, as "Roles" in `run-modes.md` says for the selected mode. `anonymous` logs out and stays out. A role with no account is not logged in: every step of its pass gets `no-account`, the other roles still run, and the run is not `blocked` for it.
- When the upstream server runs and the runbook is `mocked`, the `@<role>` fixtures must answer for this pass, so the role is selected (`POST /__runbooks/select` with `{ role: "<role>" }` and `content-type: application/json`). Who selects depends on the mode:
  - `guided`, `headless`, `headed` and `chrome`: the agent selects the role before each role's pass, then selects the pass's first step again.
  - `test` and `script`: the script selects the role in `beforeEach`, and the agent selects nothing.
  - `prompt`: the agent selects one runbook and role at a time, prints that role's prompts (one per viewport) and keeps the server up. After the `--import` of that role's reply (step 6), it selects the next role and prints its prompts, as it moves from runbook to runbook.

`ui` runbooks, for each step in order:

1. With role tracking off, a parent that is not `passed` at the same viewport makes the step `blocked-by-parent`; move on. With role tracking on, read the parents' states for the same role and viewport. A parent that is `failed`, `blocked` or `blocked-by-parent` makes the step `blocked-by-parent`. Otherwise, a parent that ended `denied`, `hidden` or `read-only` for this role, or that is `not-applicable` for it, makes the step `not-applicable` for this role, all the way down the branch. Do not run a `not-applicable` step and do not count it as blocked (`format.md`, Dependency tree).
2. When the upstream server runs, select the step first: `POST /__runbooks/select` with `{ step: "S03" }`. In `guided`, do it before showing the step. Then perform the actions in the selected mode. In `test`, `script` and `prompt` modes the selection and the `unmatched` check of item 4 follow `run-modes.md`, under "test", "script" and "prompt".
3. Compare the screen with Expected, record the state, the role (with role tracking on), the viewport, what was seen (quoted on failure) and the evidence path. In a `mocked` runbook, a step that checks a request compares the method, URL and body in `requests` of `GET /__runbooks/state` with Expected.
4. In a `mocked` runbook, read `unmatched` from `GET /__runbooks/state` after the step. A request there had no fixture and got a 501: the step is `blocked`, not `failed`, whatever item 3 saw. Name the method, path and step as the reason, and offer `/runbooks:update <id>` to record the fixture.
5. With a `Design:` line, compare the screen with its design reference, as "Design" in `run-modes.md` says, and record the differences. They do not change the state.

Execute everything before fixing anything. A failure is a finding for the report.

## 5. Write the results

Per runbook:

1. Write `<paths.runbooks>/_runs/<run id>.md` from `${CLAUDE_PLUGIN_ROOT}/templates/run-report.md`. `upstream` is the runbook's mode, `live` or `mocked`. For a `mocked` runbook, the fixtures folder (`<upstream.fixtures>/<capability>/<flow>/`) is part of the evidence, and Notes state the count of fixtures not recorded from the live API (`schema` and `hand-written`, from `fixtures <id>`). With `--record`, Notes list the fixtures written, and name each recorded request whose operation the runbook lists in neither `covers.entries` nor `calls`; the summary offers `/runbooks:update <id>` to add it (`references/format.md`, the `calls` key). `result` is `failed` when any step failed, else `blocked` when any step is `blocked` or `blocked-by-parent`, else `passed`. `partial: true` with `--steps` or `--role`. With role tracking on, write `roles` (the roles that ran, in run order), the Role column and the section for roles without an account (`templates/run-report.md`). `not-applicable` and `no-account` steps do not make the `result` `blocked`.
2. Without `--steps`:
   - new status: `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" status --current <status> --states <comma-separated states>`, with the states of every viewport, and with role tracking on of every role too, `not-applicable` and `no-account` included (`status` accepts them); write it to the runbook's `status`;
   - `last_run: { date: <YYYY-MM-DD>, commit: "<short sha>", result: <result>, report: _runs/<run id>.md }`, replacing the old value, so an `outdated: true` from `update` or `audit-runbooks --fix` goes away.
3. With `--steps` or `--role`, leave `status` and `last_run` unchanged, `outdated` included, and leave `review` as it is.

## 6. Import (prompt mode)

Parse the reply by the Import rules in `run-modes.md`, resolve every question with the user, then do step 5 with `mode: prompt`. Before step 5, when the upstream server still runs, read `GET /__runbooks/state`. An empty `requests` list means the app points elsewhere: show the `<urlEnv>=http://127.0.0.1:<port> <app.start>` hint and stop. Unmatched entries carry no step in this mode: list them in Notes, turn the steps the reply reports `failed` into `blocked` with the unmatched requests as the reason, and offer `/runbooks:update <id>`. Then, when the prompt run named runbooks still waiting, select the next one and print its prompts as "prompt" in `run-modes.md` says, and keep the server running. After the import of the last runbook, stop the server. When it no longer runs (another session, a restart), take the states from the reply alone and say in Notes that `unmatched` was not checked.

With role tracking on, these items replace the paragraph above. A runbook takes one import per role, and its report is written once, after the last role's import:

1. Parse the reply by the Import rules in `run-modes.md` and resolve its questions with the user. The prompt files are `.runbooks/prompts/<run id>-<role>-<viewport>.md` (`<run id>-<role>.md` without viewports), and each reply starts with `RUNBOOK RESULT <id> as <role> @ <viewport>` (no `@ <viewport>` without viewports). One import holds the replies of one role, one per viewport.
2. When the upstream server still runs, read `GET /__runbooks/state` and apply the checks above to this role's replies: an empty `requests` list stops the run, and unmatched entries turn the `failed` steps into `blocked`.
3. Save each reply to `.runbooks/prompts/<run id>-<role>-<viewport>.reply.md` (`<run id>-<role>.reply.md` without viewports), with the unmatched entries of item 2 under it, or a line saying `unmatched` was not checked when the server no longer runs.
4. When a role of the runbook has no saved reply yet, select the next one on the server (`{ role }`), print its prompts as "prompt" in `run-modes.md` says, keep the server running, and stop here. The next `--import` starts again at item 1.
5. After the last role's import, ask about each role and viewport with no saved reply: import it later, or record its steps as `blocked`. Then do step 5 once with `mode: prompt`, from every saved reply of the run, with the unmatched entries in Notes. Then select the next runbook and print its prompts, or stop the server after the last runbook.

## 7. Show the results

Print the results in the conversation before any commit question:

- a table with one row per runbook: its viewports, passed, failed, blocked, waived counts over all of them, the report path, and any status change. With role tracking on, add the counts per role (passed, failed, blocked, waived, `not-applicable`, `no-account`) and name the runbooks still in review;
- for each failure: step, role (with role tracking on), viewport, Expected, Seen;
- for runbooks with design references: the count of `major` and `minor` differences, each `major` one with its step, viewport, and what the design and the page show, and the references not compared;
- the runbooks left out in step 1, with the reason;
- for `api` runbooks: the scripts written or edited through `to-test`, the script mistakes fixed during the run, and the tests outside the runbook that failed.

## 8. Commit

Commit the runbook frontmatter changes (`status`, `last_run`, and `scripts` when `to-test` ran) by the `runbooks` policy, together with the script files `to-test` wrote or edited during this run. Reports are not committed: Git ignores them, so they stay local. Ask an `ask` question only after the table from step 7 is on screen; the question names the files and the message and does not repeat the table.

## 9. Close

Give the commit outcome: the short sha, or the paths left uncommitted. Then offer to investigate the causes of the failures (with `superpowers:systematic-debugging` when available), and to fix the `major` design differences; the fix is separate work.

When the `stack` is `frontend` and the config sets `tests.ui`, name each runbook of this run that has an empty `scripts` and was fully approved: a run without `--steps` or `--role`, with `result: passed` and no step `no-account`. Say that the best next step for it is a test script, written in a fresh context, and print the two commands to type, one runbook after the other:

```
/clear
/runbooks:to-test <id>
```

End with a line that offers `/runbooks:ui` to see the results by capability.

Done when every selected runbook has a report, every step in it has a state, and the user has seen the results table before any commit question.
