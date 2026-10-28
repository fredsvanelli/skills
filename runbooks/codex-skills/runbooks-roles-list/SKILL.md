---
name: runbooks-roles-list
description: "Use when the user requests runbooks roles list explicitly. List the project's roles, or show one role with its effective permissions"
---

# runbooks-roles-list

Read [runtime setup](../../skills/runbooks/references/runtime.md) first. Resolve `RUNBOOKS_PLUGIN_ROOT` as the real directory two levels above this file's directory and set `RUNBOOKS_RUNTIME` to `codex`.

Follow the [shared procedure](../../commands/roles/list.md) with the arguments from the user's message. Its `/runbooks:roles:list` spelling names this same operation. Preserve arguments and authorization; do not treat `$ARGUMENTS` as a literal value or start a second agent just to invoke the procedure.
