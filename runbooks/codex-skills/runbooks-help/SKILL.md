---
name: runbooks-help
description: "Use when the user requests runbooks help explicitly. Answer a question about the runbooks plugin, from its own docs, optionally limited to one area"
---

# runbooks-help

Read [runtime setup](../../skills/runbooks/references/runtime.md) first. Resolve `RUNBOOKS_PLUGIN_ROOT` as the real directory two levels above this file's directory and set `RUNBOOKS_RUNTIME` to `codex`.

Follow the [shared procedure](../../commands/help.md) with the arguments from the user's message. Its `/runbooks:help` spelling names this same operation. Preserve arguments and authorization; do not treat `$ARGUMENTS` as a literal value or start a second agent just to invoke the procedure.
