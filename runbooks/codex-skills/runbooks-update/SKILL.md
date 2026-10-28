---
name: runbooks-update
description: "Use when the user requests runbooks update explicitly. Update the steps of an existing runbook after the behavior it records changed"
---

# runbooks-update

Read [runtime setup](../../skills/runbooks/references/runtime.md) first. Resolve `RUNBOOKS_PLUGIN_ROOT` as the real directory two levels above this file's directory and set `RUNBOOKS_RUNTIME` to `codex`.

Follow the [shared procedure](../../commands/update.md) with the arguments from the user's message. Its `/runbooks:update` spelling names this same operation. Preserve arguments and authorization; do not treat `$ARGUMENTS` as a literal value or start a second agent just to invoke the procedure.
