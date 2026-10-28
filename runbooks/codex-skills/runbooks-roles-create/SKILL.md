---
name: runbooks-roles-create
description: "Use when the user requests runbooks roles create explicitly. Register a new role with its parents, account and permissions"
---

# runbooks-roles-create

Read [runtime setup](../../skills/runbooks/references/runtime.md) first. Resolve `RUNBOOKS_PLUGIN_ROOT` as the real directory two levels above this file's directory and set `RUNBOOKS_RUNTIME` to `codex`.

Follow the [shared procedure](../../commands/roles/create.md) with the arguments from the user's message. Its `/runbooks:roles:create` spelling names this same operation. Preserve arguments and authorization; do not treat `$ARGUMENTS` as a literal value or start a second agent just to invoke the procedure.
