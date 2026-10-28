---
name: runbooks-whats-next
description: "Use when the user requests runbooks whats-next explicitly. Compare the state of the runbooks with the code and its latest changes, and suggest the three commands that make the most sense to run now"
---

# runbooks-whats-next

Read [runtime setup](../../skills/runbooks/references/runtime.md) first. Resolve `RUNBOOKS_PLUGIN_ROOT` as the real directory two levels above this file's directory and set `RUNBOOKS_RUNTIME` to `codex`.

Follow the [shared procedure](../../commands/whats-next.md) with the arguments from the user's message. Its `/runbooks:whats-next` spelling names this same operation. Preserve arguments and authorization; do not treat `$ARGUMENTS` as a literal value or start a second agent just to invoke the procedure.
