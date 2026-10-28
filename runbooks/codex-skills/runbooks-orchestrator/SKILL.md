---
name: runbooks-orchestrator
description: "Use when the user requests runbooks orchestrator explicitly. Drive agents that take runbooks through the whole flow (map, create, run, to-test) in parallel until a goal is met"
---

# runbooks-orchestrator

Read [runtime setup](../../skills/runbooks/references/runtime.md) first. Resolve `RUNBOOKS_PLUGIN_ROOT` as the real directory two levels above this file's directory and set `RUNBOOKS_RUNTIME` to `codex`.

Follow the [shared procedure](../../commands/orchestrator.md) with the arguments from the user's message. Its `/runbooks:orchestrator` spelling names this same operation. Preserve arguments and authorization; do not treat `$ARGUMENTS` as a literal value or start a second agent just to invoke the procedure.
