---
description: Open a local read-only page with capabilities, runbooks, run history and coverage
argument-hint: "[--port n]"
disable-model-invocation: true
---

# Runbooks UI

Arguments: `$ARGUMENTS`

## Parameters

| Parameter | Use |
|---|---|
| `--port n` | the port the page listens on. Without it, the script picks its default port |

Examples: `/runbooks:ui`, `/runbooks:ui --port 4800`.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" ui $ARGUMENTS` with the Bash tool in the background, so it outlives the turn.
2. Wait for its first line, `runbooks-ui listening on http://127.0.0.1:<port>`, and give the user that URL as a link. Exit code 2 means the server did not start; show its message. For a taken port, offer `--port`. For a missing config, offer `/runbooks:setup`.
3. When the user asked for a scope of `/runbooks:coverage`, give the address of that scope too: `#/coverage?path=<glob>`, `#/coverage?feature=<y>`, `#/coverage?capability=<x>` (the value URL-encoded) or `#/coverage/<slice>`.
4. Say that the pages read the files on every reload, so runs and edits show without restarting the server, and that the history shows the runs of this machine only, because reports are ignored by Git.
5. The server stays up until the user asks to stop it or the session ends. To stop it, stop that background task.

Done when the user has the URL.
