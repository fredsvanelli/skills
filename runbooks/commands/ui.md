---
description: Open a local read-only page with capabilities, runbooks, run history and coverage
argument-hint: "[--port n] [--model inline|haiku|sonnet|opus|fable]"
disable-model-invocation: true
---

# Runbooks UI

Arguments: `$ARGUMENTS`

## Parameters

| Parameter | Use |
|---|---|
| `--port n` | the port the page listens on. Without it, the script picks its default port |
| `--model m` | accepted for consistency with the other commands: `inline`, `haiku`, `sonnet`, `opus` or `fable`. `ui` always runs in the main session, so it changes nothing |

Examples: `/runbooks:ui`, `/runbooks:ui --port 4800`.

## Model

`ui` always runs in the main session, because its server must keep running after the command ends. `--model` is accepted and changes nothing.

The page runs from the project's copy of the UI server, `<paths.runbooks>/runbooks-ui.mjs`, which `/runbooks:setup` writes. `npm run runbooks:ui` starts it, so a teammate without Claude Code opens the same page (`${CLAUDE_PLUGIN_ROOT}/docs/adr/0013-the-ui-runs-from-a-generated-copy-in-the-project.md`).

## Steps

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" ui-copy`. It prints the copy's path, or why it cannot run and exits 1: no copy, or a copy from another plugin version. On exit 1, show its line, offer `/runbooks:setup`, which writes or refreshes the copy, and stop. Never write the copy here.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" package-script` and read its `runbooks:ui` line. When it starts with `unchanged`, run `npm run runbooks:ui` with the Bash tool in the background, so it outlives the turn, adding `-- --port <n>` when the user passed `--port`. Otherwise (`missing`, `differs` or `no package.json`), run `node <path from step 1>` the same way, with `--port <n>` when given, and say that `/runbooks:setup` adds the `runbooks:ui` script. Never pass `--model` to either.
3. Wait for the line that starts with `runbooks-ui listening on http://127.0.0.1:<port>`; npm prints its own lines before it. Give the user that URL as a link. A non-zero exit means the server did not start; show its `runbooks:` line. For a taken port, offer `--port`. For a missing config, offer `/runbooks:setup`.
4. When the user asked for a scope of `/runbooks:coverage`, give the address of that scope too: `#/coverage?path=<glob>`, `#/coverage?feature=<y>`, `#/coverage?capability=<x>` (the value URL-encoded) or `#/coverage/<slice>`.
   With role tracking on (`roles.enabled` in the config), mention the roles list at `#/roles`, one role at `#/roles/<name>`, and the coverage of one role at `#/coverage?role=<name>`, the name URL-encoded. Give the address that fits when the user asked about a role.
5. Say that the pages read the files on every reload, so runs and edits show without restarting the server, and that the history shows the runs of this machine only, because reports are ignored by Git. Say that `npm run runbooks:ui` opens the same page outside Claude Code.
6. The server stays up until the user asks to stop it or the session ends. To stop it, stop that background task. The server also stops when npm exits.

Done when the user has the URL.
