---
description: Update the installed runbooks plugin to the latest version from its marketplace
argument-hint: ""
disable-model-invocation: true
---

# Upgrade the runbooks plugin

Arguments: `$ARGUMENTS`

## Parameters

None. Run `/runbooks:upgrade` from the project that uses the plugin; it updates the installs that apply there.

This command changes the plugin install only. It writes no project file and commits nothing.

## 1. Find the install

1. `claude plugin list --json`: keep the entries whose `id` starts with `runbooks@`. The part after `@` is the marketplace.
2. An install applies here when its `scope` is `user`, or when its `projectPath` is the current project root. Keep the others for the summary.
3. Entries whose `id` starts with `runbook@` are installs from before the plugin was renamed to `runbooks`. Offer to remove each with `claude plugin uninstall runbook@<marketplace> --scope <scope>`, so its commands stop showing next to these.
4. When `${CLAUDE_PLUGIN_ROOT}` is not the `installPath` of any entry, this session loads the plugin from a folder (`claude --plugin-dir`). Say so, give `git -C "${CLAUDE_PLUGIN_ROOT}" pull` as the way to update it, and stop.

Done when you hold the installs to update, each with its version, scope and marketplace.

## 2. Update

For each marketplace of those installs, run `claude plugin marketplace update <marketplace>`. Then, for each install, run `claude plugin update runbooks@<marketplace> --scope <scope> --json` from the project root.

When the result reports a marketplace-declared command to confirm (`shownCommand`), show the command to the user and ask with `AskUserQuestion` before running again with `--accept-command <sha256>`. Never pass `-y`. A failing command stops here; show its output.

## 3. Compare

Run `claude plugin list --json` again and read the new `version` of each install.

## 4. Show the result

- one line per install: scope, old version and new version, or "already up to date";
- the installs left alone in step 1 (other projects), with their `projectPath` and version;
- that the new version loads after restarting Claude Code.

When a version changed, offer `/runbooks:setup` after the restart: running it again is safe, and it brings the project's config and folders in line with what the new version expects. When the config has `upstream.serverFile`, say that `/runbooks:setup` also refreshes the copied upstream server at that path, which `list` and `coverage` warn about when its version differs from the plugin's. `upgrade` itself still copies nothing.

When the project's config has no `stack` (written before stacks existed), say that `setup` now asks for it, along with a test library per surface, and migrates `paths.e2e` to `tests.ui.dir`. Choosing `backend` or `fullstack` adds `api` runbooks, and from then on endpoints count as covered only through `api` runbooks, so endpoint coverage drops on the next `/runbooks:coverage` (`${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/coverage.md`, By surface).

Done when every install that applies here has been updated or reported as up to date, and the user knows a restart is needed.
