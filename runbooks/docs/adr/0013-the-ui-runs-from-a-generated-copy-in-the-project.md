# The UI runs from a generated copy in the project

`/runbooks:ui` used to start the page from the plugin's install folder, with `runbooks.mjs ui`. A person on the team who opened the project had no command to see the page, while `npm run runbooks:upstream` already started the upstream server from a copy in the project (ADR 0011). The upstream server is one file that imports only `node:` built-ins, so `setup` copies it as is. The UI server imports 30 plugin modules and reads `templates/ui.html`, so a copy of `ui-server.mjs` alone does not run. Now `runbooks.mjs ui-copy --write` generates `<paths.runbooks>/runbooks-ui.mjs`: one file that holds the source of every module `ui-server.mjs` reaches and the page, as strings. At startup it writes the modules to a fresh temp folder, imports them, deletes the folder before the server listens, and serves the page from memory. `setup` writes it for every stack and adds a `runbooks:ui` script to `package.json`, so `npm run runbooks:ui` starts it. `/runbooks:ui` checks the copy with `runbooks.mjs ui-copy` and runs that script. On a missing copy or one from another version, it stops and offers `/runbooks:setup`.

## Considered Options

- A launcher of about 40 lines that reads `~/.claude/plugins/installed_plugins.json`, finds the plugin's install folder for this project and runs `runbooks.mjs ui` from there. Rejected: it depends on an internal Claude Code file, and it opens nothing where the plugin is not installed.
- Copying `scripts/ui-server.mjs`, `scripts/lib/` and `templates/ui.html` into the project. Rejected: about 31 files to commit and refresh on every plugin version.
- A bundler such as esbuild. Rejected: the plugin has no dependencies, and Claude Code installs it without `npm install`, so the bundle would have to be built and committed in the plugin and kept in step with the sources.
- `/runbooks:ui` refreshes a stale copy itself. Rejected for the same reason as in ADR 0011: it writes a project file nobody asked for. `setup` writes it and commits under `commits.setup`.

## Consequences

- The copy's `VERSION` is the plugin version, so every plugin upgrade stops `/runbooks:ui` until `/runbooks:setup` refreshes the copy, as ADR 0011 accepted for the upstream copy. `/runbooks:upgrade` says so.
- The copy is about 260 KB of generated text in the project, and a refresh shows as a change to the whole file. `setup` writes it without a diff.
- The copy lives in this repository also when the UI tests live in another one (ADR 0007), because the page reads this repository's runbooks.
- The copy runs the config's `entries` command sources when the page asks, as the plugin's server does.
- npm runs the script through `sh`, which dies on SIGTERM without passing it to `node`. The UI server stops when its parent process changes, so stopping `npm run runbooks:ui` frees the port.
- `runbooks.mjs ui` stays for plugin development. No command starts it.
