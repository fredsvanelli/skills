---
name: runbooks-create
description: "Use when the user requests runbooks create explicitly. Write a new runbook from a spec, diff, ticket, description, code file, directory, route or placeholder"
---

# runbooks-create

Read [runtime setup](../../skills/runbooks/references/runtime.md) first. Resolve `RUNBOOKS_PLUGIN_ROOT` as the real directory two levels above this file's directory and set `RUNBOOKS_RUNTIME` to `codex`.

Follow the [shared procedure](../../commands/create.md) with the arguments from the user's message. Its `/runbooks:create` spelling names this same operation. Preserve arguments and authorization; do not treat `$ARGUMENTS` as a literal value or start a second agent just to invoke the procedure.
