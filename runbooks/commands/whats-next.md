---
description: Compare the state of the runbooks with the code and its latest changes, and suggest the three commands that make the most sense to run now
argument-hint: "[--since <ref>] [--model inline|haiku|sonnet|opus|fable]"
disable-model-invocation: true
---

# What's next

Arguments: `$ARGUMENTS`

## Parameters

| Parameter | Use |
|---|---|
| `--since <ref>` | optional: the base of the changes to read (`HEAD~3`, `develop`, a commit). Without it, the base is `git.base` on any other branch, and `HEAD~1` (the last commit) on `git.base` itself. Uncommitted and untracked files always count |
| `--model m` | force the model of the sub-agent this command launches: `inline` (the main session runs it), `haiku`, `sonnet`, `opus` or `fable` |

Examples: `/runbooks:whats-next`, `/runbooks:whats-next --since HEAD~5`, `/runbooks:whats-next --since develop`.

This file only dispatches. The procedure is in `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/instructions/whats-next.md`. Dispatching follows `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/agents.md`: read it before step 1. It covers the model, the brief, the report, questions, calls, commits and a model that cannot launch.

## Dispatch

1. Follow "Dispatch steps" in `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/agents.md` with the command `whats-next` and the instructions file `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/instructions/whats-next.md`. The brief carries `--since` as typed. The sub-agent reads and suggests, and runs nothing.
2. Print the `summary:` of the report as written: the state, the three suggestions with their commands, and the other candidates.
3. Ask with `AskUserQuestion` which of the three to run, with one option per suggestion and the command as its label. When the user picks one, run it by its own row: resolve `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" model <command> <arguments>` for the suggested command, carry `--model` when the user gave it to `whats-next`, and read `${CLAUDE_PLUGIN_ROOT}/commands/<name>.md` (`commands/roles/generate.md` for `/runbooks:roles:generate`) and follow it with the arguments shown. A dispatching command sends its work to its own sub-agent. That command then writes and commits by its own rules.

Done when the user has the state, three commands each with its reason, and was offered to run one.
