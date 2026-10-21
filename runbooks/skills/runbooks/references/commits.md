# Commit policy

Each command commits its own files by the policy in `commits.<type>` of the config.

| Type | Files |
|---|---|
| `runbooks` | runbook files written or edited by `map`, `create`, `update`, `audit-runbooks --fix`, `to-test` (with its spec file), and `status`/`last_run` updates from `run`. With role tracking on, also `<paths.runbooks>/roles.json` and the runbook edits of `setup`, `settings` and the `roles:*` commands |
| `setup` | the config, `README.md`, the root `.gitignore` and the two in `_runs/` and `_coverage/`, the agents block, `.mcp.json`, `.claude/settings.json` |

Run reports in `_runs/` and coverage reports in `_coverage/` stay local: each folder holds a `.gitignore` that ignores everything but itself, so no command commits them.

Older versions wrote `runs.json`, `runs.html`, `coverage.json` and `coverage.html` in `<paths.runbooks>` and ignored them with `/<paths.runbooks>/runs.*` and `/<paths.runbooks>/coverage.*` in the root `.gitignore`. `setup` deletes the four files and the two lines.

| Policy | Behavior |
|---|---|
| `never` | leave the files in the working tree without asking and list their paths at the end |
| `ask` | list the files and the proposed message, then ask with `AskUserQuestion`: Commit or Leave uncommitted |
| `auto` | commit without asking |

Every commit, `auto` or approved `ask`:

1. Stages by path only the files this command wrote: `git add -- <path> ...`.
2. Uses `git.messageFormat` with `{summary}` replaced by a short summary (`add billing.issue-invoice runbook`, `run billing.issue-invoice: passed`).
3. Ends with the attribution trailer the session asks for, if any.
4. Stays local: no push, no amend.

`auto` behaves as `ask`, and says why, when:

- the current branch is in `git.protected`;
- a file to commit already had uncommitted changes before the command ran (`git status --porcelain -- <path>` checked at the start), because staging it would carry someone else's edits.

When a pre-commit hook fails, leave the files uncommitted and show the hook output.

A command that writes several types applies each type's policy to its own files.
