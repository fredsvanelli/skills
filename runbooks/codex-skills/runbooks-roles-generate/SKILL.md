---
name: runbooks-roles-generate
description: "Use when the user requests runbooks roles generate explicitly. Read any document about who may do what (text, CSV, spreadsheet, JSON, PDF, image) and propose the roles, contexts and permissions it describes, merged into roles.json"
---

# runbooks-roles-generate

Read [runtime setup](../../skills/runbooks/references/runtime.md) first. Resolve `RUNBOOKS_PLUGIN_ROOT` as the real directory two levels above this file's directory and set `RUNBOOKS_RUNTIME` to `codex`.

Follow the [shared procedure](../../commands/roles/generate.md) with the arguments from the user's message. Its `/runbooks:roles:generate` spelling names this same operation. Preserve arguments and authorization; do not treat `$ARGUMENTS` as a literal value or start a second agent just to invoke the procedure.
