---
description: List runbooks, filtered, or the ones a diff affects
argument-hint: "[--capability x] [--feature y] [--tag t] [--status s] [--path glob] [--affected [base]]"
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
| `--affected [base]` | runbooks reached by the changes since `base`: committed, uncommitted and untracked files. `base` defaults to `git.base`. Leaves out `deprecated` runbooks and placeholders |

Examples: `/runbooks:list`, `/runbooks:list --capability billing --status draft`, `/runbooks:list --tag critical`, `/runbooks:list --affected develop`.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" list $ARGUMENTS`.
2. Show the table as printed. For each `warning:` line on stderr, add the runbook path and what to fix; the warning text names the problem.
3. With `--affected`:
   - The base defaults to `git.base` in the config.
   - The script sees changes in this repository only. When an `entries` source has a `root`, say that changes in that sibling repo do not show up here.
   - End with the command that runs them: `/runbooks:run --affected <base>`.

Exit code 2 means the script could not run; show its message (missing config: offer `/runbooks:setup`).

Done when the user has the table and every warning with its fix.
