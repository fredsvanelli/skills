---
name: runbooks-contexts-delete
description: "Use when the user requests runbooks contexts delete explicitly. Remove a context from the role registry and from its runbooks, turning each role's map on its keys into a list"
---

# runbooks-contexts-delete

Read [runtime setup](../../skills/runbooks/references/runtime.md) first. Resolve `RUNBOOKS_PLUGIN_ROOT` as the real directory two levels above this file's directory and set `RUNBOOKS_RUNTIME` to `codex`.

Follow the [shared procedure](../../commands/contexts/delete.md) with the arguments from the user's message. Its `/runbooks:contexts:delete` spelling names this same operation. Preserve arguments and authorization; do not treat `$ARGUMENTS` as a literal value or start a second agent just to invoke the procedure.
