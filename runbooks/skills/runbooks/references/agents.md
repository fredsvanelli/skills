# Dispatching a command to a sub-agent

A dispatch file is a command file that does not do the work. It picks a model, launches a sub-agent, relays its questions and prints its summary. The work lives in an instructions file that the sub-agent reads. The main session reads this reference to dispatch. The sub-agent reads it through the brief to learn the report shape and its limits.

## Choosing the model

Run this in the main session, with the arguments exactly as the user typed them:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" model <command> <arguments>
```

It prints the model of the matching row of the config table: `inline`, `haiku`, `sonnet`, `opus` or `fable`. Never read the table yourself. With `--json` it prints `{ model, row, forced }`.

- `inline` means you follow the instructions file in the main session, with `Read`, as if the command were one file. Launch no sub-agent.
- Any other value launches a sub-agent with `model` set to it.
- `forced` is true when the user passed `--model`. The value then applies to every sub-agent the command launches, and nothing escalates to another model.
- A bad `--model` exits with code 2 and prints `--model must be one of inline, haiku, sonnet, opus, fable` on stderr. Show that message and stop.

## Dispatch steps

1. Parse `$ARGUMENTS`, `--model` included.
2. Resolve the model with `runbooks.mjs model <command> <arguments>`, as above.
3. Ask the up-front questions the command needs before any work. The dispatch file lists them. After an answer that changes the arguments (the mode of `run`, for example), resolve the model again.
4. If the model is `inline`, read `<instructions file>` and follow it in this session. Otherwise launch a sub-agent with the `Agent` tool, with `model` set to the resolved value and a brief (below) that points at `<instructions file>`.
5. Relay questions and calls until the sub-agent reports `done`, `blocked` or `failed`. A report with `status: escalate` ends that sub-agent. Resolve `runbooks.mjs model to-test <id>` for the runbook it names and launch a sub-agent on that model to write or fix the runbook's script. That sub-agent never loosens an assertion. When it reports, launch a new sub-agent on the original model to run that runbook. No escalation happens when the model is forced.
6. Print the `summary:` of the report, then commit as the Commits section says.

A sub-agent that reported a question or a call stays alive and waits for your `SendMessage`. Any other status ends it.

## The brief

Fill this template. Replace `${CLAUDE_PLUGIN_ROOT}` with its value. Leave out the "Fixed decisions" block unless your own instructions give you decisions to carry (the orchestrator does).

```
You run one command of the runbooks plugin. No user is watching you. The main session is, and it reads only your last message.

Project root: <path>. Plugin root: <plugin root>.
Read first: <plugin root>/skills/runbooks/SKILL.md, <plugin root>/CONTEXT.md, <plugin root>/skills/runbooks/references/agents.md, and the instructions file below. Follow the instructions file as if the user had typed the command. Follow the files it says to read first.

Command: /runbooks:<command> <arguments>
Instructions file: <plugin root>/<instructions file>
Forced model: yes | no

Fixed decisions. Where the instructions file says to ask with AskUserQuestion, decide by these instead:
- <one decision per line>

Commits: none. Do not run git add, git commit, git stash or git checkout. The main session commits.

You cannot ask the user. Where the instructions file says to ask, stop and report status: question. Where it says to follow or run another command, stop and report status: call. When a decision is not settled here and not by a file you can read, report it as a question. Do not guess product behavior. With `Forced model: yes`, do the `to-test` work yourself when a command's instructions would escalate, and never report `escalate`.

Your last message is the report, in the shape of "The report" section of <plugin root>/skills/runbooks/references/agents.md.
```

Extra lines go before "Commits" when the command needs them: the runbook id, the lock, the files the sub-agent owns, the handoff of an earlier stage. The brief is all the sub-agent knows.

## The report

The last message of the sub-agent is the report, in this shape:

```
status: done | question | call | escalate | blocked | failed
files: <one path per line, every file you wrote or edited; none if no file>
summary: <what the command prints at the end>
question: <the question, what you tried, the readings you see, the answer you would pick and why, and the options; or none>
call: </runbooks:<command> <arguments>; or none>
escalate: <the runbook and the reason the work needs a more capable model; or none>
blocked by: <what is missing, the exact message; or none>
next: <what the work needs next, in one line>
handoff: <what the next stage must know and cannot read from the files; or none>
```

- `summary:` carries what the command prints at the end. For `run`, that is its rows of the results table and the failures. The main session prints it as written.
- `escalate:` names the runbook whose script must be written or fixed through `to-test`, and the reason. `sync` means the script is missing or out of sync with the steps. `script` means a failure looks like a mistake in the script itself. The sub-agent stops because that work needs a more capable model. With `Forced model: yes` it never reports `escalate`.
- A command that writes a report of its own (a run report, a coverage report) writes it as its instructions file says and names the path in `summary:`.

## Questions

A sub-agent cannot ask the user. Where the instructions file says to ask (an `AskUserQuestion`, "ask the user", a diff approval), the sub-agent stops with `status: question`, the question and its options.

The main session asks the user with `AskUserQuestion` and sends the answer to the same sub-agent with `SendMessage`. Load `SendMessage` with `ToolSearch` (`select:SendMessage`) when it is not loaded. Diff approvals are questions. The sub-agent puts the diff in the question and writes nothing until the answer arrives.

When the answer is in a file you can read, or is one of the fixed decisions of the brief, answer through `SendMessage` without asking the user.

## Calls to other commands

Where an instructions file says to follow or run another command, the sub-agent stops with `status: call` and `call: /runbooks:<command> <arguments>`.

The main session dispatches that command by its own row. It runs `runbooks.mjs model` for the called command and launches or follows it by the dispatch steps. It carries `--model` to the called command when the user gave it. When the called command ends, the main session sends its report to the first sub-agent with `SendMessage`, and the first sub-agent continues.

## Commits

Sub-agents never run `git add`, `git commit`, `git stash` or `git checkout`. They list every file they wrote in `files:`.

The main session commits by the command's policy (`commits.md`), after it has printed the summary. It stages the listed files by path.

## When the model cannot launch

When the `Agent` call fails because of the model, show the error. Name the row it came from (`runbooks.mjs model <command> <arguments> --json` prints it). Offer `--model` for this run and `/runbooks:settings models` for the table. Then stop. Do not retry on another model.
