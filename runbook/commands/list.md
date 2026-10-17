---
description: List runbooks, filtered, or the ones a diff affects
argument-hint: "[--capability x] [--feature y] [--tag t] [--status s] [--path glob] [--affected [base]]"
disable-model-invocation: true
---

# List runbooks

Arguments: `$ARGUMENTS`

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbook.mjs" list $ARGUMENTS`.
2. Show the table as printed. For each `warning:` line on stderr, add the runbook path and what to fix; the warning text names the problem.
3. With `--affected`:
   - The base defaults to `git.base` in the config.
   - The script sees changes in this repository only. When an `entries` source has a `root`, say that changes in that sibling repo do not show up here.
   - End with the command that runs them: `/runbook:run --affected <base>`.

`--path <glob>` filters by code path: it keeps runbooks covering an entry whose file matches the glob.

Exit code 2 means the script could not run; show its message (missing config: offer `/runbook:setup`).

Done when the user has the table and every warning with its fix.
