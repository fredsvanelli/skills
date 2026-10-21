---
description: Change a role's description, parents or account, or rename it
argument-hint: "<name>"
disable-model-invocation: true
---

# Update a role

Arguments: `$ARGUMENTS`

## Parameters

| Parameter | Use |
|---|---|
| `<name>` | the role to change. Required. `anonymous` cannot be renamed, given an account or given parents |

Examples: `/runbooks:roles:update manager`, `/runbooks:roles:update editor`.

Changes the role's entry in `<paths.runbooks>/roles.json` and, for an account or a rename, `accounts` in the config. Permissions have their own command, `/runbooks:roles:manage-permissions`. Read first: `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/config.md`, "Roles", `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/format.md`, "Roles" and "Review", and `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/commits.md`.

Run `git status --porcelain` now and keep the list for the commit step.

## 1. Load the role

1. Read `docs/runbooks/runbooks.config.json`. When it is missing, offer `/runbooks:setup` and stop. When `roles.enabled` is not true, say that role tracking is off, offer `/runbooks:settings roles`, and stop.
2. Without `<name>`, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" roles`, show the roles, and ask which one with `AskUserQuestion`. A name the registry does not have gets the same list.
3. When the name is `anonymous`, say that the role is built in and cannot be renamed, given an account or given parents, and stop.
4. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" roles <name>` and keep its effective matrix as the matrix before the change. Read `roles.json`.

Done when you hold the role, its entry and its matrix.

## 2. Ask what changes

Ask with `AskUserQuestion`, multi-select, which parts to change: description, parents, account (only with `ui` in the stack), name. Then ask the new values, in rounds of four, each question with the current value as "Keep `<value>`":

- description: one line;
- parents: multi-select over the registered roles except the role itself and `anonymous`. A parent that would close a cycle (one of the role's heirs) is not offered;
- account: the names of the environment variables, as in `create.md` (step 2, item 4). "Remove the account" is an option. Names only: never ask for, read or write a credential;
- name: kebab-case and not registered. Ask again with the reason when it is not.

Done when you hold the new values.

## 3. Work out what the change reaches

- **Rename.** Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" roles --citing <name>`. It lists the runbooks that cite the role in `roles`, in a `Roles:` line, in a role line or in an `As:` line, and the heirs. `roles: all` is left as it is, even though `--citing` lists those runbooks under `roles` (`all` expands to every name). Only explicit `roles` lists, `Roles:` lines, role lines and `As:` lines change. Open each runbook and list the lines to rewrite, and the `role:` of every `review` entry that names the old role. Add the `accounts.<name>` key of the config and the `inherits` of every heir in `roles.json`. List the fixture folders `@<name>` under `<upstream.fixtures>/<capability>/<flow>/` and `.../S<nn>/` of the mocked runbooks (`runbooks.mjs fixtures <id> --json`), which move with `git mv` to `@<new name>`. A `roles.<name>` key and a matching `origins` stay with the entry.
- **Parents.** A change of parents is a permission change. Work out the new effective matrix from the inheritance rule in `config.md`, and check it against `roles <name>` after the write in step 4. Compare the matrix before and after, key by key. Each key whose effective actions changed goes to step 5. Do the same for each heir, because their matrix follows.
- **Account and description.** They reach no runbook.

Done when you hold the files to write and the keys whose effective actions changed.

## 4. Show the diff and write

Show the diff of every file: `roles.json`, `runbooks.config.json` and, for a rename, each runbook, and the fixture folders to move. Ask whether to write them all in one write. Write only after a yes; on a no, write nothing and stop.

Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" roles <new name>` and `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" list --json`. Every runbook that cited the old name must have no new problem, and `... fixtures <id> --json` lists no problem for each mocked one that had a folder moved. When the script reports an error, fix the files until it is clean, or restore them with `git checkout -- <path>` after telling the user.

Done when the files are written and the checks are clean.

## 5. Review the permission changes

Skip this step when no key changed. Otherwise follow `${CLAUDE_PLUGIN_ROOT}/commands/roles/manage-permissions.md`, steps 4 and 5, for each key whose effective actions changed, with `--change "parents changed: <actions before> to <actions after>"`. For a key that changed for an heir, use the heir's name in `--role`. The dry run comes first, then the question, then `--write`.

Done when each chosen runbook has its entry, or the user chose none.

## 6. Show the change

Print, before any commit question:

- one line per part changed, old value and new value;
- for a rename: the runbooks rewritten, with the number of lines each (including `review` entries), the fixture folders moved, and the config keys renamed;
- for parents: the keys whose effective actions changed, per role;
- the runbooks marked for review, and the number left unmarked;
- when the account was removed: that `ui` runs give the role `no-account`.

Done when the user has seen this summary.

## 7. Commit

Commit `roles.json` and the runbooks by the `runbooks` policy, and the config by the `setup` policy. Ask an `ask` question only after the summary from step 6 is on screen; the question names the files and the message and does not repeat the summary.

Write in the config `language`.

Done when the user has seen the diffs before the write and the summary before any commit question.

## 8. Close

Give the commit outcome: the short sha, or the paths left uncommitted. Then offer `/runbooks:update <id>` for each runbook marked for review, which writes the role lines and clears the review.
