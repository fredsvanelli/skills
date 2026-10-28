---
name: runbooks-to-test
description: "Use when the user requests runbooks to-test explicitly. Write or adopt the test script of a runbook, in the project's test library for its surface"
---

# runbooks-to-test

Read [runtime setup](../../skills/runbooks/references/runtime.md) first. Resolve `RUNBOOKS_PLUGIN_ROOT` as the real directory two levels above this file's directory and set `RUNBOOKS_RUNTIME` to `codex`.

Follow the [shared procedure](../../commands/to-test.md) with the arguments from the user's message. Its `/runbooks:to-test` spelling names this same operation. Preserve arguments and authorization; do not treat `$ARGUMENTS` as a literal value or start a second agent just to invoke the procedure.
