---
name: runbooks-roles-update
description: "Use when the user requests runbooks roles update explicitly. Change a role's description, parents or account, or rename it"
---

# runbooks-roles-update

Read [runtime setup](../../skills/runbooks/references/runtime.md) first. Resolve `RUNBOOKS_PLUGIN_ROOT` as the real directory two levels above this file's directory and set `RUNBOOKS_RUNTIME` to `codex`.

Follow the [shared procedure](../../commands/roles/update.md) with the arguments from the user's message. Its `/runbooks:roles:update` spelling names this same operation. Preserve arguments and authorization; do not treat `$ARGUMENTS` as a literal value or start a second agent just to invoke the procedure.
