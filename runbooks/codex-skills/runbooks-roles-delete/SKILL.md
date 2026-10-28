---
name: runbooks-roles-delete
description: "Use when the user requests runbooks roles delete explicitly. Remove a role from the registry, the config and the runbooks that cite it"
---

# runbooks-roles-delete

Read [runtime setup](../../skills/runbooks/references/runtime.md) first. Resolve `RUNBOOKS_PLUGIN_ROOT` as the real directory two levels above this file's directory and set `RUNBOOKS_RUNTIME` to `codex`.

Follow the [shared procedure](../../commands/roles/delete.md) with the arguments from the user's message. Its `/runbooks:roles:delete` spelling names this same operation. Preserve arguments and authorization; do not treat `$ARGUMENTS` as a literal value or start a second agent just to invoke the procedure.
