---
description: Drive agents that take runbooks through the whole flow (map, create, run, to-test) in parallel until a goal is met
argument-hint: "[--goal \"<text>\"] [--max-agents <n>] [--model inline|haiku|sonnet|opus|fable]"
disable-model-invocation: true
---

# Orchestrate runbook agents

Arguments: `$ARGUMENTS`

## Parameters

| Parameter | Use |
|---|---|
| `--goal "<text>"` | what the runbooks should look like when the command ends, in your own words: a capability (`Implement all clients runbooks`), one runbook (`Implement users.create runbook until it's active`), a state (`Make every draft runbook active`), a change (`Update the billing runbooks after the diff from develop`). Without it, the command asks |
| `--max-agents <n>` | how many agents work at the same time. Default 4. An integer of 1 or more |
| `--model m` | force every stage on that model: `inline` (same model as this session), `haiku`, `sonnet`, `opus` or `fable`. Without it, each stage takes the model of its command's row in the config table. This command itself always runs in the main session |

Examples: `/runbooks:orchestrator`, `/runbooks:orchestrator --goal "Implement all clients runbooks"`, `/runbooks:orchestrator --goal "Implement users.create runbook until it's active" --max-agents 2`.

With no argument, the command asks for both. With only `--goal`, it keeps the default of 4 agents.

This command launches and supervises agents, and writes no runbook itself. It reads the install, turns the goal into units of work, and then launches agents that follow the instructions files of the other commands, one stage at a time, each on the model of its command's row. It answers the agents' questions when a file or a rule settles them, and relays the others to the user. It commits what the agents wrote. It stops when the goal is met or when the user interrupts it, and not before.

Every `runbooks.mjs` call below is `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" <command>`, run from the project root. Read `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/SKILL.md` and `${CLAUDE_PLUGIN_ROOT}/CONTEXT.md` first; the agents read them too.

Write to the user in the config `language`, else English. Write the briefs to the agents in English. Command names, ids, file names and the terms of `CONTEXT.md` stay as they are.

## 1. Read the arguments

1. `--goal` is the text after it, quoted or up to the next `--` parameter. `--max-agents` must be an integer of 1 or more; anything else gets the error and the default of 4, said in the output. `--model` is kept and passed to every stage (step 5). A bad value exits with code 2 in `runbooks.mjs model`: show its message and stop.
2. Run `git status --porcelain` and keep the list: a file that is dirty now is never staged by this command (step 7).

Done when you hold the goal (or know it is missing) and the agent count.

## 2. Read the install

1. `docs/runbooks/runbooks.config.json`. When it is missing, say the project has no install, offer `/runbooks:setup` and stop.
2. `runbooks.mjs list --json`. Exit code 2 stops the command: show the message and the fix it names (`/runbooks:roles:generate` or `/runbooks:roles:create` for `roles.json not found`, `/runbooks:settings` for a config error).
3. `runbooks.mjs coverage --json`: keep the `uncovered` entries per slice.
4. From the config, keep `stack`, `language`, `app.baseUrl`, `app.start`, `accounts`, `tests`, `upstream`, `mcp`, `roles.enabled`, `commits`, `git`.
5. With `--goal` missing, ask with `AskUserQuestion`, two questions in one call:
   - the goal, with up to three options built from the state, each a goal sentence the user can keep as it is: the capability with most placeholders (`Implement all <capability> runbooks`), `Make every draft runbook active` when drafts exist, `Write the script of every active runbook that has none` when such runbooks exist, `Map the project and implement every placeholder` when nothing else fits. The user types any other goal under "Other";
   - the agent count, options `1`, `2`, `4 (Recommended)` and `8`.

Done when you hold the goal, the agent count, the config, the runbook list and the uncovered entries.

## 3. Plan the units

A unit is one runbook taken from where it is to a target. A stage is one command an agent follows for that unit. The flow of a runbook, from `templates/readme.md` (Lifecycle), gives the stages:

| Stage | The agent follows | Needs the lock (step 6) | Moves the runbook |
|---|---|---|---|
| `map` | `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/instructions/map.md`, with the filter of the goal | no | writes placeholders for the flows no runbook cites |
| `create` | `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/instructions/create.md`, `--from placeholder <id>` or the source the goal names | only for a `mocked` `ui` runbook, which records its fixtures. The lock passes to the `run --record` call it makes (step 6) | `placeholder` to `draft` |
| `update` | `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/instructions/update.md`, `<id> --from <source>` | as `create`, with the same hand-over | keeps the status, marks `last_run` outdated |
| `to-test` | `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/instructions/to-test.md`, `<id>` | yes, it runs the script once | fills `scripts` |
| `run` | `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/instructions/run.md`, `<id> --mode <mode>` for a `ui` runbook, `<id> --mode test` for an `api` runbook, which always runs through its script | yes | `draft` to `active` on a full pass |

Targets, from `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/format.md` (Status):

| Target | Means | Goal words |
|---|---|---|
| `draft` | the runbook is written | "write", "draft" |
| `active` | written and a full run passed | "active", "until it passes" |
| `scripted` | `active` and its `scripts` list a script that ran | "script", "to-test", or no state word at all: this is the complete flow and the default |

The stages of a unit, in order, by `surface`:

- `ui`: `create` when the runbook is a placeholder or does not exist; `run` when the target is `active` or beyond and `status` is not `active`, or `last_run.result` is `failed` or `blocked`, or `last_run.outdated` is true; `to-test` last, when the target is `scripted` and `scripts` is empty. The script comes last because a `ui` runbook runs in the browser without it.
- `api`: `create` as for `ui`; then `to-test` when `scripts` is empty, because an `api` runbook runs only through its script; then `run`. `active` and `scripted` are the same target here.
- `update` opens the list, in place of `create`, when the goal says the behavior changed ("update", "after the diff", "changed") or when step 6 finds a run failed because the runbook text is wrong. Its `--from` is the goal's source, else `diff <git.base>`.

Turn the goal into units:

1. A runbook id (`users.create`): that runbook. An id `list --json` does not have gets the closest ids, and the command asks which one.
2. A capability name, or "all <capability> runbooks": every runbook of `list --capability <x> --json`, and a `map --capability <x>` unit first when `coverage --capability <x> --json` lists uncovered entries. "all", "every", "the project": the same without a filter.
3. A state ("every draft", "the ones never run", "active runbooks with no script"): the runbooks `list --json` matches.
4. A change ("after the diff", "since develop"): `list --affected <base> --json`, each as an `update` unit.
5. Leave out `deprecated` runbooks always. A runbook with `problems` is `invalid`: name it in the plan with its problems and leave it out, because no stage fixes frontmatter by hand.
6. A goal no stage expresses (build a feature, register a role, change the config) is not this command's work: say what the command does and the command that does the rest, and stop. A goal that fits two readings gets one `AskUserQuestion` with the readings as options, before anything is launched.

Order the units: the `map` unit first and alone, because the others may be its placeholders. Then units closest to their target first (a `draft` with a passing script before a placeholder), `critical` tags first inside a tier.

Show the plan before anything is launched: one line per unit with the id, the `surface`, the `upstream` mode, the status now, the target and the stages, then the units left out and why. A plan with no unit means the goal is already met: say so and stop.

Done when every unit has its stages, and the user has seen the plan.

## 4. Check the environment

An agent cannot fix any of these, so check them once, before the first launch:

1. **Run mode for `ui` runbooks.** `headless` when `.mcp.json` has the `mcp.headless` server and its tools are in this session; else `script` (`${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/run-modes.md`). `guided`, `headed`, `chrome` and `prompt` are never used here: they need a person or a visible browser. Say which mode the plan uses.
2. **The app.** With a `ui` run in the plan, `curl -s -o /dev/null -w '%{http_code}' <app.baseUrl>`. When it does not answer, ask with `AskUserQuestion`: start it yourself with `app.start` in the background and check again, or wait while the user starts it (the user answers when it is up), or stop. Check again after the answer.
3. **The upstream API.** With a `live` `ui` runbook in the plan and `upstream.baseUrl` set, the same check on it; `upstream.start` when it does not answer, the same question.
4. **Accounts.** For each role the units' runbooks run, the env var names of its `accounts` entry exist in `mcp.secretsFile`: `grep -c '^NAME=' <file>`, never a value. A missing name is one question to the user now, not a blocked run later. With role tracking on, a role with no entry gets `no-account` and the run goes on; say which roles.
5. **Test command.** An `api` unit, or a `ui` `to-test` stage, needs `tests.<surface>.command`; without it, offer `/runbooks:settings tests` and stop.
6. **The port.** Nothing listens on `upstream.port` now: `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:<port>/__runbooks/state` returns `000`. A server left by an earlier session answers `200`: stop it when its process is `runbooks.mjs upstream` or `upstream-server.mjs` (`lsof -i :<port>` or `ss -ltnp`), else ask the user.

Done when the mode is fixed and every check passed or the user settled it.

## 5. Brief an agent

Each stage goes to a new agent with a brief. One agent, one stage: the agent ends when its stage ends, and the next stage of the same unit starts another agent with a clean context. An agent that carried `create` into `run` would hold the whole investigation of the code while it drives the browser, and would run out of room or lose track.

**The model.** Resolve it per stage, in this session, with the arguments the stage gets (`run` gets `<id> --mode <mode>` for a `ui` runbook and `<id> --mode test` for an `api` runbook):

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" model <stage command> <stage arguments> [--model <x>]
```

Add `--model <x>` only when the user gave it: it forces every stage and every call, and turns off escalation. The output is `inline`, `haiku`, `sonnet`, `opus` or `fable`. Launch the `Agent` with `model` set to it. For `inline`, launch the `Agent` with no `model`: the stage runs on the model of this session, and it is still a sub-agent. Never read the table yourself. `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/agents.md` ("Choosing the model") says more, and says what to do when the model cannot launch. This command itself stays in the main session whatever `--model` says.

**The brief.** The brief is all the agent knows, so it holds every decision the agent would otherwise ask, and the handoff of the stage before. Fill "The brief" of `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/agents.md`, with `${CLAUDE_PLUGIN_ROOT}` replaced by its value, and these values:

- `Command:` the stage, `/runbooks:<command> <arguments>`.
- `Command file:` (the "Instructions file" line) `<plugin root>/skills/runbooks/instructions/<command>.md`, as the table of step 3 gives.
- `Forced model:` `yes` when the user gave `--model`, else `no`.
- The Fixed decisions block, which this command always carries:

```
Fixed decisions. Where the instructions file says to ask with AskUserQuestion, decide by these instead:
- Run mode for ui runbooks: <mode>. Never guided, headed, chrome or prompt.
- Viewports of a new ui runbook: every viewport in the config, unless the flow is one screen size by design.
- Design links: link a screen when the design reference is configured and a frame matches the screen by name; else leave `design` empty and say so.
- Flows of a `--from dir` source: every flow found.
- to-test candidates: adopt a candidate that maps to at least one step, as the command recommends; write a new file otherwise.
- Waived steps: none. A step you would waive is a question.
- Runbook and report prose in the config language; headings and keys in English.
```

- The extra lines, before "Commits":

```
Runbook: <id> (<surface>, upstream <mode>, status <status>). Target of its unit: <target>.
Previous stages of this unit: <one line each with its result, or "none">.
Handoff from the stage before: <its handoff lines, or "none">.
Lock: <"yours: you may start the upstream server, open the browser and run the test command. Stop the server before you end." | "not yours: do not start the upstream server, open a browser or run the test command. If the stage cannot finish without one, stop and report it.">
Files you own: <runbook path>, <fixtures folder>, <script path or default path>. Write nothing else: not the config, roles.json, .mcp.json, other runbooks, CI files or the project's tests outside your script.
Do not guess product behavior: a result that looks like a bug (a role that gets in where its siblings get 403, a message that contradicts the screen, a spec the code disagrees with) is a question, with both readings and the two lines below filled, because without them the orchestrator cannot tell a misread from a bug.
```

- The report. The agent ends with the shape of "The report" in `agents.md`, and this command adds these lines to it, which its checks in step 6 need:

```
runbook: <id> <status before> -> <status after>
run: <result and report path, or none>
script: <path, or none>
expected from: <only with a question about a disagreement: where the Expected came from, the code file and line, or the requirement id and its source file>
seen from: <only with that question: the code file and line that produce what was seen, or "not found">
```

The only messages an agent gets after its brief are the answer to a question it reported and the report of a call it made (step 6), through `SendMessage`. Nothing else continues an agent: no second stage, no "now run it". When a stage ends, so does its agent.

## 6. Run the loop

Keep a board: one line per unit with its stages, the stage in flight, the agent of that stage, the attempt count and the status now. Print it after every event.

The lock is the one thing agents share: the app, the browser, the upstream server (one port, one selected runbook) and the project's test database. One stage holds it at a time. Every other stage runs in parallel, up to `--max-agents` agents in flight, the lock holder included.

Repeat until every unit is at its target or skipped:

1. **Dispatch.** While fewer than `--max-agents` agents are in flight and a unit has a next stage: a stage that needs the lock launches only when no one holds it, and takes it. Among the ready stages, launch the lock stage first when the lock is free, then the stages of the units closest to their target. The `map` unit runs alone, before the others launch.
   - Every stage, the first of a unit or a later one, is a new `Agent` call with the brief and the `model` of step 5. A later stage carries the reports of the earlier stages in its brief, the `handoff` lines above all. Never send a later stage to the agent of the earlier one: its context is spent on work the new stage does not need.
   - `SendMessage` is used for two things: the answer to a question an agent reported, and the report of a call it made, so that agent finishes its own stage. Load the tool with `ToolSearch` (`select:SendMessage`) when it is not loaded.
2. **Read a report.** Verify the report against the files: after `create` or `update`, `list --json` has the id with the expected `status` and no `problems`; after `run`, `check <id> --json` has `latest.result` and, for a promotion, `status: active`; after `to-test`, `scripts` is not empty and the file exists. A report that says `done` and fails these is `failed`, with the gap as the reason.
   - `done`: the agent is finished and is not used again. Free the lock when the stage held it, then the port check of step 4 item 6; a server left running is stopped. Advance the unit, and keep the report for the brief of its next stage; when it reached its target, commit by step 7.
   - `question`: triage it (below). Other agents keep working meanwhile.
   - `call`: the agent stops and waits, as for a question. Dispatch the command it names as part of the same unit, by step 5: resolve its model with `runbooks.mjs model` (with `--model` when the user gave it), then launch a new agent with the brief of that command. The caller does nothing until the called report arrives, so the called agent takes over the caller's lock and its in-flight slot, and gives both back when it ends. Its brief says `Lock: yours` when the caller held the lock. A called command never commits. When it reports, `SendMessage` its report to the calling agent, which continues its own stage. A call from the called agent is handled the same way. The files of the called report go into the unit's files for step 7.
   - `escalate`: the agent ended. Add a `to-test` stage for the runbook it names, resolved by its row, and launch it before the `run` stage is launched again. The `to-test` agent never loosens an assertion. When it reports `done`, launch the `run` stage again on its original model. When the user gave `--model`, nothing escalates: the brief says `Forced model: yes` and the agent does the work itself. A `to-test` stage added this way needs the lock, as in step 3.
   - `blocked` or `failed`: when the cause is the environment (the app stopped answering, the upstream server, a port, a missing env var name), fix it as step 4 says and launch the stage again, once. When a step failed because the Expected and what the surface showed disagree, decide by the table below. Anything else, or a second failure of the same stage, goes to the user.

**Expected A, seen B.** No agent and not this command changes the application's code: the plugin writes runbooks, scripts and reports. So the question is only whether the runbook changes or waits. What decides it is where A came from, which the report's `expected from` and `seen from` lines say. Without those lines, ask the agent for them through `SendMessage` first.

| A came from | B means | Who decides | Action |
|---|---|---|---|
| the code itself (`create --from file`, `dir`, `route` or `placeholder`), and `seen from` names a line that plainly produces B | the agent misread the code, or the environment's data differ from what it assumed | this command | add `update <id> --from file <seen from file>` before the `run`; the runbook records what the code does |
| a spec, a ticket or the user's text (`create --from spec`, `ticket`, `text`), or a requirement id | the code and the requirement disagree | the user | the question below |
| the code, but B contradicts a rule visible in the code itself (a guard, a validation, a comment, a test of the project) | a probable bug in the application | the user | the question below |
| a run that passed before (`last_run.result` was `passed`) | a regression or a changed behavior | the user | the question below, with `git log --oneline <last_run.commit>..HEAD` and the files of the diff that reach the runbook |

The question to the user quotes the step, the Expected with its source, what was seen with the code line that produces it, and offers three options:

1. **The runbook is wrong.** Add `update <id> --from file <seen from file>` (or `--from text` with the user's words) before the `run`, and go on.
2. **The application is wrong.** The unit pauses. The failed report stays in `_runs/` as the record of the bug, and an `active` runbook that failed stays `active` with the failure in `last_run` (`format.md`, Status). Nothing is written to the runbook. When the user says the fix is in, launch the `run` stage again; the other units go on meanwhile.
3. **Skip the unit.** It stays on the board as skipped, with the step and the two readings in the close.

**Triage of a question.** Answer it yourself, through `SendMessage`, when the answer is in a file you can read (the config, `roles.json`, the code, a plugin reference, the runbook), when it is one of the fixed decisions, or when the choice has no product consequence: a file path, which placeholder is the flow's, a test name, which viewport, adopting a candidate script that maps to steps. Note every answer you gave: the close lists them.

Relay it to the user, with `AskUserQuestion`, when the answer depends on what the product should do (is this a bug, which Expected is right when the code and the spec disagree), on credentials, accounts or an environment you cannot reach, on an action that is hard to undo (deleting data, changing an assertion of the project's own tests, waiving a step), on the scope of the goal (a flow the goal may or may not include), or when you would be guessing. Quote the agent's question and its readings, give its options as the options, and wait. The other agents go on; the asking agent waits for your `SendMessage`.

A stage that failed twice gets the same question to the user, with three options: launch it again, skip the unit, stop the command. A skipped unit stays on the board as skipped and the goal completes without it, said in the close.

Done when every unit is at its target or skipped, or the user stopped the command.

## 7. Commit

The agents never commit. This command does, by `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/commits.md`, policy `commits.runbooks`, with the files each agent reported and nothing else:

- `auto`: one commit per unit when it reaches its target, staged by path (`git add -- <path> ...`), with `git.messageFormat` and a summary that names the unit and its stages (`add clients.create runbook, script and first run`, `run billing.issue-invoice: passed`). A unit with a file that was dirty at step 1 behaves as `ask`, and says why.
- `ask`: no question per unit. Gather the files and ask once at the close, one proposed commit per unit, Commit or Leave uncommitted for each.
- `never`: list the paths per unit at the close.

Scripts under `tests.ui.root`, when it points to a UI tests repository, get their own commit there, by the "UI tests repository" rules of `commits.md`. Reports in `_runs/` are local and never committed.

When the user interrupts, the files written so far are committed by the same rules, from the reports received, before the close.

## 8. Close

1. **Result.** One line per unit: the id, status at the start and at the end, the run result and report path, the script path, the commit sha or the paths left uncommitted. Then the skipped units with the reason, and the units left out of the plan.
2. **Decisions.** The questions you answered yourself, one line each with the agent's question and your answer, so the user can check them.
3. **Open.** What the goal did not reach, if anything, and the one command that continues it (`/runbooks:orchestrator --goal "..."` with the rest, or `/runbooks:whats-next`).

Done when the goal is met, or the user stopped the command, and the user has the result, the decisions and the paths of everything written.
