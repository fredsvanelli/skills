---
description: Update the installed runbooks plugin to the latest version from its marketplace
argument-hint: "[--model <model>]"
disable-model-invocation: true
---

# Upgrade the runbooks plugin

Before following this procedure, read [runtime setup](../skills/runbooks/references/runtime.md). Resolve the plugin root from this file's real location and use the active host's tools and argument handling. Do this also when this entry is invoked directly.

Arguments: `$ARGUMENTS`

## Parameters

| Parameter | Use |
|---|---|
| `--model m` | run this command in a sub-agent on that model: `inline` (the main session runs it, the default), `haiku`, `sonnet`, `opus` or `fable` on Claude; `inherit` or an available model ID on Codex |

Run `/runbooks:upgrade` from the project that uses the plugin; it updates the installs that apply there.

This command changes the plugin install only. It writes no project file and commits nothing.

## Model

With `--model` set to a value other than `inline`, follow "Dispatch steps" in `${RUNBOOKS_PLUGIN_ROOT}/skills/runbooks/references/agents.md` with this file as the instructions file, and the sub-agent skips this section. Otherwise follow the file below as usual.

## Codex upgrade

When the active runtime is Codex, follow this section instead of the Claude steps
below. Check `codex plugin --help`, `codex plugin list --help` and
`codex plugin marketplace --help` for the installed CLI's capabilities first.
If it lacks the operations below, explain the supported host UI update flow and
stop; do not invent `codex plugin update` or invoke `claude plugin`.

1. Run `codex plugin list --json` and identify installed `runbooks@<marketplace>`
   entries. Match `installedPath` to the resolved plugin root. Inspect
   `codex plugin marketplace list` to determine whether the source is local or Git.
   If no install matches, report that this session uses a local checkout and give
   its repository update command as a suggestion; do not pull a dirty checkout.
2. For a Git-backed marketplace, run
   `codex plugin marketplace upgrade <marketplace>` to refresh its snapshot.
   For a local marketplace, use its files as they are; tell the user that updating
   the source checkout is separate. Do not run a Git marketplace refresh on a
   local source or claim to have fetched its repository.
3. Run `codex plugin add runbooks@<marketplace> --json` to install/refresh that
   entry from its marketplace. The tested CLI 0.165.0 refreshes the cache on
   re-add; if the installed host does not support this, report its result and
   give the host UI update action. Stop on errors. Preserve existing enablement
   and authentication decisions; if the command requests a new authorization,
   relay it instead of automatically accepting it.
4. Compare the returned version and installed path with the previous ones and
   `codex plugin list --json`. Report updated, refreshed at the same version,
   already current, or failed according to evidence. Explain that a new session
   must load the refreshed skills. Offer `$runbooks:runbooks-setup` to refresh the project's
   generated UI/upstream copies after restart; upgrade does not write them.

Keep unrelated plugins and other marketplaces unchanged. Commit nothing.

## Claude Code upgrade

The following steps apply only on Claude Code.

## 1. Find the install

1. `claude plugin list --json`: keep the entries whose `id` starts with `runbooks@`. The part after `@` is the marketplace.
2. An install applies here when its `scope` is `user`, or when its `projectPath` is the current project root. Keep the others for the summary.
3. Entries whose `id` starts with `runbook@` are installs from before the plugin was renamed to `runbooks`. Offer to remove each with `claude plugin uninstall runbook@<marketplace> --scope <scope>`, so its commands stop showing next to these.
4. When `${RUNBOOKS_PLUGIN_ROOT}` is not the `installPath` of any entry, this session loads the plugin from a folder (`claude --plugin-dir`). Say so, give `git -C "${RUNBOOKS_PLUGIN_ROOT}" pull` as the way to update it, and stop.

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

When a version changed, offer `/runbooks:setup` after the restart: running it again is safe, and it brings the project's config and folders in line with what the new version expects. Say that `/runbooks:setup` also refreshes the UI copy at `<paths.runbooks>/runbooks-ui.mjs`, and that `/runbooks:ui` stops until it does, because it starts only a copy from the plugin's version. When the config has `upstream.serverFile`, say that `/runbooks:setup` also refreshes the copied upstream server at that path, which `list` and `coverage` warn about when its version differs from the plugin's. `upgrade` itself still copies nothing.

When `runbooks.mjs list` warns that an `entries` source or a `slices` glob is outside the project, say that the endpoints of an API in another repository no longer count here, and that `/runbooks:setup` or `/runbooks:settings sources` moves them to `calls` with a dry run first (`${RUNBOOKS_PLUGIN_ROOT}/docs/adr/0005-upstream-api-in-another-repo-is-a-contract.md`). From runbooks 2.0 such a path is a config error.

When the project's config has no `stack` (written before stacks existed), say that `setup` now asks for it, along with a test library per surface, and migrates `paths.e2e` to `tests.ui.dir`. Choosing `backend` or `fullstack` adds `api` runbooks, and from then on endpoints count as covered only through `api` runbooks, so endpoint coverage drops on the next `/runbooks:coverage` (`${RUNBOOKS_PLUGIN_ROOT}/skills/runbooks/references/coverage.md`, By surface).

When a version changed and the project's config has no `roles` key, say that this version can track roles per runbook, and that `/runbooks:setup` or `/runbooks:settings roles` turns it on. Until then nothing changes: with `roles.enabled` false or missing, every command behaves as before (`${RUNBOOKS_PLUGIN_ROOT}/skills/runbooks/references/config.md`, Roles).

Done when every install that applies here has been updated or reported as up to date, and the user knows a restart is needed.
