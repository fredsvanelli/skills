---
description: Remove a role from the registry, the config and the runbooks that cite it
argument-hint: "<name>"
disable-model-invocation: true
---

# Delete a role

Arguments: `$ARGUMENTS`

## Parameters

| Parameter | Use |
|---|---|
| `<name>` | the role to delete. Required. `anonymous` cannot be deleted |

Examples: `/runbooks:roles:delete support-agent`.

Removes the role from `<paths.runbooks>/roles.json`, `accounts.<name>` from the config and every line that names the role from the runbooks. Read first: `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/config.md`, "Roles", `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/format.md`, "Roles" and "Review", and `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/commits.md`.

Run `git status --porcelain` now and keep the list for the commit step.

## 1. Load the role

1. Read `docs/runbooks/runbooks.config.json`. When it is missing, offer `/runbooks:setup` and stop. When `roles.enabled` is not true, say that role tracking is off, offer `/runbooks:settings roles`, and stop.
2. Without `<name>`, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" roles`, show the roles, and ask which one with `AskUserQuestion`. A name the registry does not have gets the same list.
3. When the name is `anonymous`, say that the role is built in and stop.
4. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" roles <name>` and keep its effective matrix. Read `roles.json`.

Done when you hold the role and its matrix.

## 2. List what cites the role

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" roles --citing <name>` and show it: the runbooks that cite the role in `roles`, in a `Roles:` line, in a role line or in an `As:` line, and the heirs (roles that inherit from it, directly or not).

Done when the user has seen the runbooks and the heirs.

## 3. Decide about the heirs

Skip this step when the role has no heirs. Otherwise ask with `AskUserQuestion`, before anything is written, one question for all heirs:

- Copy: each heir gets the role's effective permissions as its own entries, so its effective matrix does not change. Where the heir already has an entry for the key, its own entry stays.
- Drop: the heirs lose what they inherited from the role. For each key where an heir's effective actions shrink, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" roles --affected --role <heir> --key <key>` and collect the runbooks. They get `review` with `role-deleted` in step 6.

Both answers remove the role from every heir's `inherits`. A copied entry has no `origins` entry, because the copy is the user's decision.

Done when you hold the answer, and for Drop the runbooks to mark.

## 4. Show the diff and write

The write has four parts, in one go:

1. `roles.json`: remove the role's entry, remove it from every `inherits`, and apply the Copy answer.
2. `runbooks.config.json`: remove `accounts.<name>` when it exists.
3. Each runbook from step 2: remove `<name>` from `roles` (a runbook left with `roles` empty is a problem: tell the user and ask with `AskUserQuestion` whether to set `all` or deprecate it), remove it from `Roles:` lines (a line left empty is removed), remove its role lines, and remove the `As: <name>` of a step. A `review` entry of `role-permissions` or `role-created` for this role is removed too.
4. Nothing else. Reports in `_runs/` stay as they are.

Show the diff of every file and ask whether to write them. Write only after a yes; on a no, write nothing and stop.

Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" roles` and `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" list --json`. Every runbook must have no new problem. When the script reports an error, fix the files until it is clean, or restore them with `git checkout -- <path>` after telling the user.

Done when the files are written and the checks are clean.

## 5. Mark the heirs' runbooks

Skip this step unless the answer in step 3 was Drop and runbooks were collected. Show them grouped by heir, then ask: mark all, mark none, or pick some. Then run, for the chosen ids:

`node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" mark-review <id...> --reason role-deleted --role <name>`

Run it without `--write` first, show what it adds to each runbook, and ask whether to write. On a yes, run it again with `--write`.

Done when each chosen runbook has its entry, or the user chose none.

## 6. Show the change

Print, before any commit question:

- the role deleted, and the files written, each marked updated;
- the runbooks rewritten, with the number of lines removed from each;
- the heirs, with Copy or Drop;
- the runbooks marked `role-deleted`, with the command that resolves each: `/runbooks:update <id>`;
- when the role had an account: that the environment variables it named are left in place for the user to delete.

## 7. Commit

Commit `roles.json` and the runbooks by the `runbooks` policy, and the config by the `setup` policy. Ask an `ask` question only after the summary from step 6 is on screen; the question names the files and the message and does not repeat the summary.

Write in the config `language`.

Done when the user has seen the diffs before the write and the summary before any commit question.
