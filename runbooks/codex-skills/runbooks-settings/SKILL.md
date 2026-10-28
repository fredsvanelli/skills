---
name: runbooks-settings
description: "Use when the user requests runbooks settings explicitly. Change what setup configured (stack, test libraries, design reference, app, accounts, viewports, sources, git and commit policy, MCP servers)"
---

# runbooks-settings

Read [runtime setup](../../skills/runbooks/references/runtime.md) first. Resolve `RUNBOOKS_PLUGIN_ROOT` as the real directory two levels above this file's directory and set `RUNBOOKS_RUNTIME` to `codex`.

Follow the [shared procedure](../../commands/settings.md) with the arguments from the user's message. Its `/runbooks:settings` spelling names this same operation. Preserve arguments and authorization; do not treat `$ARGUMENTS` as a literal value or start a second agent just to invoke the procedure.
