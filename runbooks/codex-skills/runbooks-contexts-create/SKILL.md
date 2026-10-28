---
name: runbooks-contexts-create
description: "Use when the user requests runbooks contexts create explicitly. Register a new context of the role registry with its keys and cases, then mark the runbooks it reaches for review"
---

# runbooks-contexts-create

Read [runtime setup](../../skills/runbooks/references/runtime.md) first. Resolve `RUNBOOKS_PLUGIN_ROOT` as the real directory two levels above this file's directory and set `RUNBOOKS_RUNTIME` to `codex`.

Follow the [shared procedure](../../commands/contexts/create.md) with the arguments from the user's message. Its `/runbooks:contexts:create` spelling names this same operation. Preserve arguments and authorization; do not treat `$ARGUMENTS` as a literal value or start a second agent just to invoke the procedure.
