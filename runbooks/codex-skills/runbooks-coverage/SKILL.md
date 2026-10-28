---
name: runbooks-coverage
description: "Use when the user requests runbooks coverage explicitly. Runbook coverage report, overall or per capability, feature, slice or path"
---

# runbooks-coverage

Read [runtime setup](../../skills/runbooks/references/runtime.md) first. Resolve `RUNBOOKS_PLUGIN_ROOT` as the real directory two levels above this file's directory and set `RUNBOOKS_RUNTIME` to `codex`.

Follow the [shared procedure](../../commands/coverage.md) with the arguments from the user's message. Its `/runbooks:coverage` spelling names this same operation. Preserve arguments and authorization; do not treat `$ARGUMENTS` as a literal value or start a second agent just to invoke the procedure.
