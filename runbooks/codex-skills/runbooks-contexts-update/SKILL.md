---
name: runbooks-contexts-update
description: "Use when the user requests runbooks contexts update explicitly. Change a context's keys, cases or description, then mark the runbooks the change reaches for review"
---

# runbooks-contexts-update

Read [runtime setup](../../skills/runbooks/references/runtime.md) first. Resolve `RUNBOOKS_PLUGIN_ROOT` as the real directory two levels above this file's directory and set `RUNBOOKS_RUNTIME` to `codex`.

Follow the [shared procedure](../../commands/contexts/update.md) with the arguments from the user's message. Its `/runbooks:contexts:update` spelling names this same operation. Preserve arguments and authorization; do not treat `$ARGUMENTS` as a literal value or start a second agent just to invoke the procedure.
