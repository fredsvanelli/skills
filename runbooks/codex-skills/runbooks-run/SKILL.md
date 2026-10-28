---
name: runbooks-run
description: "Use when the user requests runbooks run explicitly. Run runbooks (ui in the browser or through a per-step script, api through their test script), live or against fixtures, and record a report per runbook"
---

# runbooks-run

Read [runtime setup](../../skills/runbooks/references/runtime.md) first. Resolve `RUNBOOKS_PLUGIN_ROOT` as the real directory two levels above this file's directory and set `RUNBOOKS_RUNTIME` to `codex`.

Follow the [shared procedure](../../commands/run.md) with the arguments from the user's message. Its `/runbooks:run` spelling names this same operation. Preserve arguments and authorization; do not treat `$ARGUMENTS` as a literal value or start a second agent just to invoke the procedure.
