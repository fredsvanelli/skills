# Run runbooks: instructions

When you run this file in the main session (model `inline`), the arguments and answers of the dispatch file stand in for the brief, and you start and stop the upstream server yourself in every mode.

You run the group of runbooks your brief names, in the mode and with the flags it gives. The main session selected the runbooks, asked the mode and the `--waive` reason, and gave each runbook its run id. The parameters are in `${CLAUDE_PLUGIN_ROOT}/commands/run.md`.

Read first: `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/format.md` (step states, dependency tree, status) and `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/run-modes.md` (the mode you will use). For a `ui` runbook, also `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/upstream.md` (the upstream modes, the server and its control routes). With role tracking on (`roles.enabled` in the config), also the Roles sections of `run-modes.md` and `format.md`, and for a runbook with cases the "Contexts and cases" section of `format.md`. The role steps below apply only then, and the case steps only to a runbook with cases (`cases` in the `list --json` output is not empty).

## 1. Your selection

The brief lists the runbook ids of the group, the mode, the flags (`--steps`, `--role`, `--case`, `--record`, `--waive`, `--import`) and the run id of each runbook (`<YYYY-MM-DD-HHMM>-<runbook id>`). Select nothing else. With `--waive`, the brief carries the reason the user gave; read it there.

In mode `prompt` and for `--import`, the main session starts, keeps and stops the upstream server. Where the steps below say to keep the server running or to stop it after the last import, do nothing and say in `summary:` whether the last runbook's import is done.

`ui` runbooks follow every step below, except that one run in mode `test` follows the "test" section of `run-modes.md` for its execution, as `api` runbooks do. `api` runbooks run in mode `test`, by that section, and use steps 2 to 4 as it says.

`--record` needs a browser mode (`guided`, `headless`, `headed` or `chrome`). A script selects `mocked` and overrides `record`. A prompt run is not read until the import, and the server must stay up for it. With `--import`, go to step 6.

## 2. Check preconditions

For `api` runbooks: item 1 of "test" in `run-modes.md`, then item 2 (sync), which writes or completes the script through `to-test` when needed (with `Forced model: no`, report `status: escalate` instead, as that item says). The `ui` checks below do not apply to them.

For `ui` runbooks:

- The app answers at `app.baseUrl` (`curl -s -o /dev/null -w '%{http_code}' <baseUrl>`). This reachability check is the only direct request allowed besides the upstream checks below; it verifies nothing about a result. When the app is down, show the `app.start` commands and stop.
- The upstream server runs when the project has any `mocked` runbook (`list --json`, field `upstream`, over all runbooks and not only the selection) or the run has `--record`. The app then points at the server for live runbooks too, because the server proxies them in `live` mode. The server is the project's copy, never the plugin's file. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" upstream-copy` first. When it exits 1, show its line, offer `/runbooks:setup`, and stop before the first step: do not copy or refresh the server here, because that would add a file change nobody asked for to this run. When it exits 0, it prints the copy's path: start `node <that path>` from the project root in the background, with no flags (it reads the config), and wait for its first line, `runbooks-upstream listening on http://127.0.0.1:<port>`. A taken port exits 2 with a message naming the port and `upstream.port`: show it and stop. Stop the server when the run ends. In mode `prompt`, and for `--import`, the main session owns the server: the brief says it is already up at its port. Do not start or stop it, and send the select calls with `curl` as usual.
- When the upstream server runs, in `guided`, `headless`, `headed` and `chrome`, the app reaches the server. Select the first runbook (`POST /__runbooks/select`, step 4 says how), navigate once to its first page in the browser, then read `GET /__runbooks/state`. Zero `requests` means the app points elsewhere: show `<urlEnv>=http://127.0.0.1:<port> <app.start>` and stop. `script` checks this where it reads its results (`run-modes.md`, "script"), and `prompt` at the import (step 6). Mode `test` does not check it (`run-modes.md`, "test", item 3).
- When the config sets `upstream.baseUrl` and the selection has a `live` runbook, `upstream.baseUrl` answers (one `curl` as above). When it does not, show `upstream.start` and stop. With `--record`, the same check applies to every selected runbook.
- With `upstream.schema` set, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" fixtures <id>` for each `mocked` runbook before its first step. The command exits 0 with problems in its findings. Problems make the runbook `blocked`, not `failed`, with the problems as the reason; offer `/runbooks:to-test <id>` and `/runbooks:update <id>`. Skip the check for a runbook being recorded: the run is about to record or change its fixtures, so checking the old ones first would block it for nothing.
- Each account the runbooks' `roles` need has its env var names in `mcp.secretsFile`: `grep -c '^<NAME>=' <secretsFile>` prints a count, never a value. With role tracking off, a missing name blocks the steps that log in as that role. With role tracking on, a `ui` role with no `accounts` entry, or whose names are missing, is not blocked. Its whole pass gets `no-account` (`run-modes.md`, Roles). `anonymous` needs no account.
- With role tracking on, before the first step: list the roles of each `ui` runbook that get `no-account`, and warn for each runbook with a `review` entry that its Expected may be out of date (`format.md`, Review). The run goes on, and a run does not clear `review`.
- In the browser, each precondition's data is visible. A missing precondition makes the steps that need it `blocked`, with the reason. For a runbook with cases, the record of each case is built and checked before that case's pass (step 4), not here.
- With design references and a mode that compares them (`run-modes.md`, Design): the `design.mcp` server's tools are loaded, or the Artifact tool for `claude-design`. When they are not, say before the first step that the design is not compared in this run, and why; the steps still run.

## 3. Order

Build each runbook's dependency tree from the `Parents:` lines and order the steps by the rules in `format.md`. A `ui` runbook with `viewports` runs that order once per viewport, in the frontmatter order, each pass holding the steps its `Viewports:` lines allow. With role tracking on, the passes are role outer and viewport inner: all viewports of the first role, then all viewports of the next, each pass holding the steps its `Roles:` and `Viewports:` lines allow. `--role` keeps only the listed roles. With cases, take the passes from `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" passes <id> --json [--role a,b] [--case a,b]`, in its order: role, then case, then viewport. Each pass holds the steps its `Roles:`, `Cases:` and `Viewports:` lines allow. A role that runs once has one pass per viewport, with the case `*`, and builds the data of its `dataCase`. Give `passes` only the roles and cases of `--role` and `--case` that the runbook has (`roles` and `cases` in `list --json`), and report the others as skipped, because `passes` exits 2 on a role or case the runbook does not have. Before every pass after the first, follow the runbook's Cleanup and check its preconditions again, because the previous pass used the data. With `--steps`, run only the listed steps, plus nothing else; a listed step whose parent is not in the list runs only when the user confirms the parent's state from the last report.

## 4. Execute

`api` runbooks, and `ui` runbooks in mode `test`: items 3 to 5 of "test" in `run-modes.md`. With `--steps`, run the whole script and keep only those steps from the `junit` output.

`ui` runbooks with `viewports`: before each pass, set the browser to the viewport's size as "Viewports" in `run-modes.md` says for the selected mode.

`ui` runbooks, before each runbook, when the upstream server runs: `POST /__runbooks/select` with `{ runbook: "<id>", mode }`, where `mode` is `record` with `--record`, else the runbook's `upstream` (`mocked` or `live`). A new runbook resets the step and clears the request log. With role tracking on, a mocked runbook also gets the role selected before each pass (see below). The agent sends every select with `curl` and `-H 'content-type: application/json'` (`upstream.md`, "Control routes"). In mode `test`, the script selects the runbook and the step itself in `beforeEach`, and the agent selects nothing. In `script` mode the generated script selects each step, and in `prompt` mode the agent selects one runbook at a time, as "prompt" in `run-modes.md` says.

`ui` runbooks with cases, before each case of a role, after the role has logged in (below): run Cleanup when a previous case of this run used data, then build the record of the pass's `dataCase` from its Preconditions `Cases:` line and check it in the browser. A `mocked` runbook gets the record from its `+<case>` fixtures instead, once the case is selected. A record that cannot be built makes every step of that pass `blocked`, with the reason, and the run goes on with the next case. An `api` script builds each case's record in its own tests, so the agent builds nothing for it.

`ui` runbooks with role tracking on, before each role's pass:

- Log out and log in as the role with its `accounts` entry, as "Roles" in `run-modes.md` says for the selected mode. `anonymous` logs out and stays out. A role with no account is not logged in: every step of its pass gets `no-account`, the other roles still run, and the run is not `blocked` for it.
- When the upstream server runs and the runbook is `mocked`, the `@<role>` fixtures must answer for this pass, so the role is selected (`POST /__runbooks/select` with `{ role: "<role>" }` and `content-type: application/json`). Who selects depends on the mode:
  - `guided`, `headless`, `headed` and `chrome`: the agent selects the role before each role's pass, then selects the pass's first step again. With cases, it selects the role and the pass's `dataCase` together before each pass (`{ role: "<role>", case: "<case>" }`), so the `+<case>` fixtures answer.
  - `test` and `script`: the script selects the role, and the case with cases, in `beforeEach`, and the agent selects nothing.
  - `prompt`: the agent selects one runbook and role at a time (one runbook, role and case with cases), prints the prompts of that unit (one per viewport) and keeps the server up. After the `--import` of that role's reply (step 6), it selects the next role and prints its prompts, as it moves from runbook to runbook.

`ui` runbooks, for each step in order:

1. With role tracking off, a parent that is not `passed` at the same viewport makes the step `blocked-by-parent`; move on. With role tracking on, read the parents' states for the same role and viewport, and the same case with cases. A parent that is `failed`, `blocked` or `blocked-by-parent` makes the step `blocked-by-parent`. Otherwise, a parent that ended `denied`, `hidden` or `read-only` for this role, or that is `not-applicable` for it, makes the step `not-applicable` for this role, all the way down the branch. Do not run a `not-applicable` step and do not count it as blocked (`format.md`, Dependency tree).
2. When the upstream server runs, select the step first: `POST /__runbooks/select` with `{ step: "S03" }`. In `guided`, do it before showing the step. Then perform the actions in the selected mode. In `test`, `script` and `prompt` modes the selection and the `unmatched` check of item 4 follow `run-modes.md`, under "test", "script" and "prompt".
3. Compare the screen with Expected, with the role line that applies in the pass's case (a line naming the case wins over the role's line with no case). Record the state, the role (with role tracking on), the case (with cases: the pass's case, `*` for a role that runs once), the viewport, what was seen (quoted on failure) and the evidence path. In a `mocked` runbook, a step that checks a request compares the method, URL and body in `requests` of `GET /__runbooks/state` with Expected.
4. In a `mocked` runbook, read `unmatched` from `GET /__runbooks/state` after the step. A request there had no fixture and got a 501: the step is `blocked`, not `failed`, whatever item 3 saw. Name the method, path and step as the reason, with the `operationName`, `variables` or `body` when the entry has them, and offer `/runbooks:update <id>` to record the fixture.
5. With a `Design:` line, compare the screen with its design reference, as "Design" in `run-modes.md` says, and record the differences. They do not change the state.

Execute everything before fixing anything. A failure is a finding for the report.

## 5. Write the results

Per runbook:

1. Write `<paths.runbooks>/_runs/<run id>.md` from `${CLAUDE_PLUGIN_ROOT}/templates/run-report.md`. `upstream` is the runbook's mode, `live` or `mocked`. For a `mocked` runbook, the fixtures folder (`<upstream.fixtures>/<capability>/<flow>/`) is part of the evidence, and Notes state the count of fixtures not recorded from the live API (`schema` and `hand-written`, from `fixtures <id>`). With `--record`, Notes list the fixtures written, and name each recorded request whose operation the runbook lists in neither `covers.entries` nor `calls`; the summary offers `/runbooks:update <id>` to add it (`references/format.md`, the `calls` key). `result` is `failed` when any step failed, else `blocked` when any step is `blocked` or `blocked-by-parent`, else `passed`. `partial: true` with `--steps`, `--role` or `--case`. With role tracking on, write `roles` (the roles that ran, in run order), the Role column and the section for roles without an account (`templates/run-report.md`). With cases, write `cases` (the cases that ran, in run order) and the Case column, `*` for a role that ran once. Notes name the roles that ran once, because their permissions do not change by case. `not-applicable` and `no-account` steps do not make the `result` `blocked`.
2. For a full run (no `--steps`, `--role` or `--case`), run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" last-run <id> --report <run id>.md --write`. It writes `last_run` with the state of every cell and the run that proved it, and moves `status` when no cell is pending or outdated. A full run clears `outdated` on every cell it ran, so the `outdated: true` from `update` or `audit --fix` goes away. Without `--write` the command prints the plan and writes nothing.
3. For a partial run with `--merge`, run the same command with `--merge`: `last-run <id> --merge --report <run id>.md --write`. It writes only the cells the report covers, keeps the others, clears `outdated` on the cells it ran, and recomputes `status`. Without `--merge`, a partial run changes neither `status` nor `last_run`, `outdated` included, and the command refuses it with exit 2. `--merge` alone, with no `--steps`, `--role` or `--case`, is a full run: say so once.
4. `review` stays as it is in every case.

## 6. Import (prompt mode)

Parse the reply by the Import rules in `run-modes.md`, resolve every question with the user, then do step 5 with `mode: prompt`. Before step 5, when the upstream server still runs, read `GET /__runbooks/state`. An empty `requests` list means the app points elsewhere: show the `<urlEnv>=http://127.0.0.1:<port> <app.start>` hint and stop. Unmatched entries carry no step in this mode: list them in Notes, turn the steps the reply reports `failed` into `blocked` with the unmatched requests as the reason, and offer `/runbooks:update <id>`. Then, when the prompt run named runbooks still waiting, select the next one and print its prompts as "prompt" in `run-modes.md` says, and keep the server running. After the import of the last runbook, stop the server. When it no longer runs (another session, a restart), take the states from the reply alone and say in Notes that `unmatched` was not checked.

With role tracking on, these items replace the paragraph above. A runbook takes one import per role, and its report is written once, after the last role's import. With cases, read "role" below as "role and case": one import per pass unit of `passes <id>`, files named `<run id>-<role>-<case>[-<viewport>]`, and the next unit selected with `{ role, case }`:

1. Parse the reply by the Import rules in `run-modes.md` and resolve its questions with the user. The prompt files are `.runbooks/prompts/<run id>-<role>-<viewport>.md` (`<run id>-<role>.md` without viewports), and each reply starts with `RUNBOOK RESULT <id> as <role> @ <viewport>` (no `@ <viewport>` without viewports). One import holds the replies of one role, one per viewport.
2. When the upstream server still runs, read `GET /__runbooks/state` and apply the checks above to this role's replies: an empty `requests` list stops the run, and unmatched entries turn the `failed` steps into `blocked`.
3. Save each reply to `.runbooks/prompts/<run id>-<role>-<viewport>.reply.md` (`<run id>-<role>.reply.md` without viewports), with the unmatched entries of item 2 under it, or a line saying `unmatched` was not checked when the server no longer runs.
4. When a role of the runbook has no saved reply yet, select the next one on the server (`{ role }`, or `{ role, case }` with cases, because a role without a case resets the case), print its prompts as "prompt" in `run-modes.md` says, keep the server running, and stop here. The next `--import` starts again at item 1.
5. After the last role's import, ask about each role and viewport with no saved reply: import it later, or record its steps as `blocked`. Then do step 5 once with `mode: prompt`, from every saved reply of the run, with the unmatched entries in Notes. Then select the next runbook and print its prompts, or stop the server after the last runbook.


## 7. Report

Your report follows "The report" in `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/agents.md`. List in `files:` every report, runbook file and script you wrote or edited. Put in `summary:`, for the runbooks of your group:

- a table with one row per runbook: its viewports, passed, failed, blocked, waived counts over all of them, the report path, and any status change. With role tracking on, add the counts per role (passed, failed, blocked, waived, `not-applicable`, `no-account`) and name the runbooks still in review. With cases, split each role's counts per case, and name the roles that ran once (case `*`);
- for each failure: step, role (with role tracking on), case (with cases), viewport, Expected, Seen;
- for runbooks with design references: the count of `major` and `minor` differences, each `major` one with its step, viewport, and what the design and the page show, and the references not compared;
- for `api` runbooks: the scripts written or edited through `to-test`, the script mistakes fixed during the run, and the tests outside the runbook that failed.

In mode `prompt`, the main session prints for the user what you print, so `summary:` lists every prompt file path you wrote (`.runbooks/prompts/...`) and which runbook, role and case still wait for an import.

A sub-agent that stops with `status: escalate` keeps in `summary:` the rows of the runbooks it finished.

With `Forced model: no`, a runbook that needs `to-test` work stops the run with `status: escalate`. Name the runbook and the reason (`sync` or `script`) in `escalate:`, and list in `handoff:` the runbooks of your group that have not run yet.

Done when every runbook of the group has a report, every step in it has a state, and the report is sent.
