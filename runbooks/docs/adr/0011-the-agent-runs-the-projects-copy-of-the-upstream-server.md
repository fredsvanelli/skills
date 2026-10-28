# The agent runs the project's copy of the upstream server

`run` and `to-test` used to start the mock server from the plugin's install folder, with `runbooks.mjs upstream`. The copy that `setup` writes into the project served only CI, and it needed `--fixtures` and other flags because it never read the config. A person on the team who opened the project had no command to start the server, and the agent and CI ran two different files. Now the copy is the only server the agent, the team and CI start. Started without `--fixtures`, it reads `<root>/docs/runbooks/runbooks.config.json`, where the root is `--root <dir>` or the current folder, and takes the port, fixtures folder, target and redact lists from the `upstream` block. It starts `live` when `upstream.baseUrl` is set and `mocked` otherwise, the rule the CI command already followed; `upstream.mode` stays a runbook default, and a select sets each runbook's mode. `setup` copies the server whenever the config has an `upstream` block and adds a `runbooks:upstream` script to `package.json`, so `npm run runbooks:upstream` starts it. `run`, `to-test` and the orchestrator check the copy with `runbooks.mjs upstream-copy` and stop on a missing copy or one from another version.

## Considered Options

- An npm package in `devDependencies`. Rejected by the user: the copy `setup` already writes is enough, and a package would need publishing and a version pin per project.
- The agent keeps the plugin's file while the team and CI use the copy. Rejected: the two files drift between `setup` runs, and a run would pass on behavior CI does not have.
- `run` refreshes a stale copy itself. Rejected: it writes a project file nobody asked for into the run's commit. The orchestrator may run `setup` before any stage starts, because `setup` commits on its own.
- A `--config <path>` flag on the copy. Rejected: a config at an arbitrary path leaves no rule to find the root its relative paths resolve from. `--root` names that root.

## Consequences

- The copy's `VERSION` is the plugin version, so every plugin upgrade, even one that leaves the server unchanged, stops `run` until `/runbooks:setup` refreshes the copy. `/runbooks:upgrade` already offers `setup`. Teammates on different plugin versions stop each other's runs until they match.
- A live-only project gets the copy and the script too, unused until its first mocked runbook.
- With `tests.ui.root`, the copy lives in the UI tests repository, so `run` and `npm run runbooks:upstream` need that repository cloned next to this one.
- Started with `--fixtures`, the copy behaves as before and reads no config, so existing CI jobs and framework configs keep working.
- `runbooks.mjs upstream` stays for plugin development and now starts in the same mode as the copy.
