---
name: runbooks-contexts-list
description: "Use when the user requests runbooks contexts list explicitly. List the contexts of the role registry, or show one context with its runbooks"
---

# runbooks-contexts-list

Read [runtime setup](../../skills/runbooks/references/runtime.md) first. Resolve `RUNBOOKS_PLUGIN_ROOT` as the real directory two levels above this file's directory and set `RUNBOOKS_RUNTIME` to `codex`.

Follow the [shared procedure](../../commands/contexts/list.md) with the arguments from the user's message. Its `/runbooks:contexts:list` spelling names this same operation. Preserve arguments and authorization; do not treat `$ARGUMENTS` as a literal value or start a second agent just to invoke the procedure.
