---
name: runbooks-upgrade
description: "Use when the user requests runbooks upgrade explicitly. Update the installed runbooks plugin to the latest version from its marketplace"
---

# runbooks-upgrade

Read [runtime setup](../../skills/runbooks/references/runtime.md) first. Resolve `RUNBOOKS_PLUGIN_ROOT` as the real directory two levels above this file's directory and set `RUNBOOKS_RUNTIME` to `codex`.

Follow the [shared procedure](../../commands/upgrade.md) with the arguments from the user's message. Its `/runbooks:upgrade` spelling names this same operation. Preserve arguments and authorization; do not treat `$ARGUMENTS` as a literal value or start a second agent just to invoke the procedure.
