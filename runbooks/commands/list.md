---
description: List runbooks, filtered, or the ones a diff affects
argument-hint: "[--capability x] [--feature y] [--tag t] [--status s] [--path glob] [--role r] [--review] [--affected [base]] [--model inline|haiku|sonnet|opus|fable]"
disable-model-invocation: true
---

# List runbooks

Arguments: `$ARGUMENTS`

## Parameters

Filters combine: a runbook is listed when it matches all of them. Without any, every runbook is listed.

| Parameter | Use |
|---|---|
| `--capability x` | runbooks in the capability folder `x` |
| `--feature y` | runbooks with `feature: y` |
| `--tag t` | runbooks tagged `t` (`critical`) |
| `--status s` | runbooks with that status: `placeholder`, `draft`, `active` or `deprecated` |
| `--path glob` | runbooks covering an entry whose file matches the glob |
| `--role r` | role tracking on only: runbooks whose `roles` include the role (`all` counts for every registered role) |
| `--review` | role tracking on only: runbooks with a `review` entry |
| `--affected [base]` | runbooks reached by the changes since `base`: committed, uncommitted and untracked files. `base` defaults to `git.base`. Leaves out `deprecated` runbooks and placeholders |
| `--model m` | run this command in a sub-agent on that model: `inline` (the main session runs it, the default), `haiku`, `sonnet`, `opus` or `fable` |

Examples: `/runbooks:list`, `/runbooks:list --capability billing --status draft`, `/runbooks:list --tag critical`, `/runbooks:list --role editor`, `/runbooks:list --review`, `/runbooks:list --affected develop`.

## Model

With `--model` set to a value other than `inline`, follow "Dispatch steps" in `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/agents.md` with this file as the instructions file, and the sub-agent skips this section. Otherwise follow the file below as usual.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" list $ARGUMENTS`.
2. Show the table as printed. For each `warning:` line on stderr, add the runbook path and what to fix; the warning text names the problem.
3. With `--affected`:
   - The base defaults to `git.base` in the config.
   - The script sees changes in this repository only. A change in an upstream API in another repository reaches this project as a new version of `upstream.schema`. A reason `upstream schema: <METHOD /path> changed` (or `added`, `removed`) means that file changed that operation and the runbook's `calls` name it; offer `/runbooks:update <id>` to record its fixtures again and `runbooks.mjs contract` to see what broke (`${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/upstream.md`, Contract). Without `upstream.schema`, nothing here shows an API change (`${CLAUDE_PLUGIN_ROOT}/docs/adr/0005-upstream-api-in-another-repo-is-a-contract.md`). When the loader warns about an `entries` source outside the project, say that it never showed changes either, and offer `/runbooks:settings sources`.
   - End with the command that runs them: `/runbooks:run --affected <base>`.

With `--review`, add for each runbook its review reasons and offer `/runbooks:update <id>`, which writes the role lines and clears the review.

Exit code 2 means the script could not run; show its message (missing config: offer `/runbooks:setup`).

Done when the user has the table and every warning with its fix.
