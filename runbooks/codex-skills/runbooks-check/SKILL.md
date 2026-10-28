---
name: runbooks-check
description: "Use when the user requests runbooks check explicitly. Show the result of a runbook's latest run, or say it was never run"
---

# runbooks-check

Read [runtime setup](../../skills/runbooks/references/runtime.md) first. Resolve `RUNBOOKS_PLUGIN_ROOT` as the real directory two levels above this file's directory and set `RUNBOOKS_RUNTIME` to `codex`.

Follow the [shared procedure](../../commands/check.md) with the arguments from the user's message. Its `/runbooks:check` spelling names this same operation. Preserve arguments and authorization; do not treat `$ARGUMENTS` as a literal value or start a second agent just to invoke the procedure.
