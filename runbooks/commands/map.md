---
description: Map the code as it is now into placeholder runbooks, one per flow no runbook cites yet
argument-hint: "[--capability x | --slice name | --path glob] [--model inline|haiku|sonnet|opus|fable]"
disable-model-invocation: true
---

# Map the code into placeholders

Arguments: `$ARGUMENTS`

## Parameters

Use at most one filter. Without one, the command maps the whole project.

| Parameter | Use |
|---|---|
| `--capability x` | map only entries whose file is in the slice `x` of the config `slices` |
| `--slice name` | the same as `--capability` |
| `--path glob` | map only entries whose file matches the glob (`src/app/**/billing/**`) |
| `--model m` | force the model of the sub-agent this command launches: `inline` (the main session runs it), `haiku`, `sonnet`, `opus` or `fable` |

With a filter, a requirement is mapped only when it belongs to a flow mapped in that scope.

Examples: `/runbooks:map`, `/runbooks:map --capability billing`, `/runbooks:map --path "src/app/**/deliveries/**"`.

This file only dispatches. The procedure is in `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/instructions/map.md`. Dispatching follows `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/agents.md`: read it before step 2. It covers the model, the brief, the report, questions, calls, commits and a model that cannot launch.

## Dispatch

1. Run `git status --porcelain` now and keep the list for the commit step.
2. Follow "Dispatch steps" in `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/agents.md` with the command `map` and the instructions file `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/instructions/map.md`. The brief carries the filter as typed. The command asks nothing before the work.
3. Print the `summary:` of the report as written: the map, before any commit question.
4. **Commit.** Commit by the `runbooks` policy, staging by path the placeholder files the report lists in `files:`. Ask an `ask` question only after the summary from step 3 is on screen; the question names the files and the message and does not repeat the summary.
5. **Close.** Give the commit outcome: the short sha, or the paths left uncommitted. Offer `/runbooks:create --from placeholder <id>` for the three placeholders the summary ranks first.

Done when the user has seen the map before any commit question.
