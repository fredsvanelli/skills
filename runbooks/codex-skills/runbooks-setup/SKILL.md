---
name: runbooks-setup
description: "Use when the user requests runbooks setup explicitly. Prepare this project for runbooks (stack, test libraries, design reference, folders, config, agents block, MCP servers)"
---

# runbooks-setup

Read [runtime setup](../../skills/runbooks/references/runtime.md) first. Resolve `RUNBOOKS_PLUGIN_ROOT` as the real directory two levels above this file's directory and set `RUNBOOKS_RUNTIME` to `codex`.

Follow the [shared procedure](../../commands/setup.md) with the arguments from the user's message. Its `/runbooks:setup` spelling names this same operation. Preserve arguments and authorization; do not treat `$ARGUMENTS` as a literal value or start a second agent just to invoke the procedure.
