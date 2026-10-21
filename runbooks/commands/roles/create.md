---
description: Register a new role with its parents, account and permissions
argument-hint: "[name]"
disable-model-invocation: true
---

# Create a role

Arguments: `$ARGUMENTS`

## Parameters

| Parameter | Use |
|---|---|
| `[name]` | the new role, kebab-case (`^[a-z0-9][a-z0-9-]*$`) and not registered yet. Without it, the command asks |

Examples: `/runbooks:roles:create`, `/runbooks:roles:create support-agent`.

Adds the role to `<paths.runbooks>/roles.json` and, for a `ui` stack, its login to `accounts` in the config. Read first: `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/config.md`, "Roles", and `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/commits.md`. The permission questions are those of `${CLAUDE_PLUGIN_ROOT}/commands/roles/manage-permissions.md` (step 2).

Run `git status --porcelain` now and keep the list for the commit step.

## 1. Check that tracking is on

Read `docs/runbooks/runbooks.config.json`. When it is missing, offer `/runbooks:setup` and stop. When `roles.enabled` is not true, say that role tracking is off, offer `/runbooks:settings roles`, and stop. Read `roles.json` and run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" roles` to show the registered roles.

Done when tracking is on and you hold the registry.

## 2. Ask about the role

Ask with `AskUserQuestion`, in rounds of four:

1. The name, when `$ARGUMENTS` has none. A name that is not kebab-case, or that is already registered, or is `anonymous`, is asked again with the reason.
2. A one-line description.
3. The parents (`inherits`), multi-select over the registered roles, with "None" as the recommended answer. `anonymous` cannot be a parent. A role with parents starts with their effective matrix and gets its own entries only where it differs.
4. With `ui` in the stack: the names of the environment variables that hold the login, for the `accounts.<name>` entry (`emailEnv`, `passwordEnv`, and `loginPath` when the login page is not the default). Names only: never ask for, read or write a credential. Ask "No account yet" as an option; the role then gets `no-account` on `ui` runs until `/runbooks:roles:update` adds one.

`found` for the new role is `["user"]`.

Done when you hold the name, description, parents and account.

## 3. Ask the permissions

Ask what the role may do with the questions of `manage-permissions.md`, step 2, starting from the effective matrix its parents give. A key typed here has no `origins` entry.

Done when you hold the role's own entries, or the user chose to leave the matrix to the parents.

## 4. Show the diff and write

Show the diff of `roles.json` and, with an account, of `runbooks.config.json`. Ask whether to write both. Write only after a yes; on a no, write nothing and stop. Keep the key order of the files.

Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" roles <name>`. When the script reports an error, fix the files until it loads them, or restore them with `git checkout -- <path>` after telling the user.

Done when both files are written and the script shows the role.

## 5. Mark the runbooks

For each key in the role's effective matrix, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" roles --affected --role <name> --key <key>`. Merge the runbooks of the groups into one list and show it. When the list is empty, say so and go to step 6.

Ask with `AskUserQuestion`: mark all with `role-created`, mark none, or pick some. On "pick some", ask which runbooks, multi-select in rounds of four. Then run, for the chosen ids:

`node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" mark-review <id...> --reason role-created --role <name>`

Run it without `--write` first, show what it adds to each runbook, and ask whether to write. On a yes, run it again with `--write`. Each marked runbook needs Expected lines for the new role, which `/runbooks:update <id>` writes and then clears the review.

Done when each chosen runbook has its entry, or the user chose none.

## 6. Show the change

Print, before any commit question:

- the role with its description, parents, account variable names and own permissions;
- the effective matrix from `roles <name>`;
- the runbooks marked, and the number left unmarked;
- when the role has no account: that `ui` runs give it `no-account`.

## 7. Commit

Commit `roles.json` and the marked runbooks by the `runbooks` policy, and the config by the `setup` policy. Ask an `ask` question only after the summary from step 6 is on screen; the question names the files and the message and does not repeat the summary.

Write in the config `language`.

Done when the user has seen the diff before the write and the summary before any commit question.
