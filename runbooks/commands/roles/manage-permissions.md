---
description: Change what a role may do on each capability/feature key, then mark the runbooks the change reaches for review
argument-hint: "<name>"
disable-model-invocation: true
---

# Manage a role's permissions

Arguments: `$ARGUMENTS`

## Parameters

| Parameter | Use |
|---|---|
| `<name>` | the role to change. Required. `anonymous` is allowed, and its matrix usually stays empty |

Examples: `/runbooks:roles:manage-permissions editor`, `/runbooks:roles:manage-permissions manager`.

Edits `<paths.runbooks>/roles.json` and marks affected runbooks with `review`. `create` runs the same questions for a new role (step 2). Read first: `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/config.md`, "Roles", and `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/format.md`, "Review". Commit policy: `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/commits.md`.

Run `git status --porcelain` now and keep the list for the commit step.

## 1. Load the role

1. Read `docs/runbooks/runbooks.config.json`. When it is missing, offer `/runbooks:setup` and stop. When `roles.enabled` is not true, say that role tracking is off, offer `/runbooks:settings roles`, and stop.
2. Without `<name>`, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" roles`, show the roles, and ask which one with `AskUserQuestion`. A name the registry does not have gets the same list.
3. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" roles <name>` and show the effective matrix: each key, its actions, whether they are the role's own, inherited from a role or overridden, and the keys marked `guess`.
4. Read `roles.json`. Keep the `actions` list: the four base actions (`view`, `create`, `edit`, `delete`) plus the project's.

Done when the user has seen the effective matrix and you hold the registry.

## 2. Ask what changes

Ask with `AskUserQuestion`, in rounds of four. First ask which kind of change:

- change the actions of a key;
- add a key;
- remove a key;
- add a project action to `actions`.

"Other" ends the loop. Repeat until the user has nothing more to change. Then ask the details of each kind:

- Change the actions of a key. Offer the keys of the effective matrix, then ask the actions the role has on the key, multi-select over the registry's `actions`, with the current ones as the recommended answer. Changing a key the role only inherits writes an own entry that replaces the inherited one (`config.md`, "Inheritance and override"). Removing every action writes an empty list, which overrides the parent and leaves the role without access.
- Add a key. Ask `<capability>/<feature>` or `<capability>/*`, with the names of the runbook frontmatter. Offer the keys of `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" list --json` that no entry of this role covers. Then ask its actions as above.
- Remove a key. Offer the role's own keys. An inherited key is not removed here: say so, and offer an own entry with an empty list instead.
- Add a project action. Ask for the identifier. It is English, lowercase and not one of the base four. It goes into the top-level `actions` list, and the user can then give it to keys.

A key the user edits loses its `origins` entry, because the user's answer replaces what the scanner deduced. A key the user adds has none.

Done when you hold every change, as old actions and new actions per key.

## 3. Show the diff and write

Show the diff of `roles.json` and ask whether to write it. Write only after a yes; on a no, write nothing and stop. Keep the file's key order, with `version` first.

Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" roles <name>`. When the script reports a registry error, fix the file until it loads, or restore it with `git checkout -- <path>` after telling the user.

Done when `roles.json` is written and the script loads it.

## 4. Find the affected runbooks

For each key whose actions changed, or that was added or removed:

`node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" roles --affected --role <name> --key <key>`

It lists the runbooks of the role and of the roles that inherit from it, grouped by role. A new project action in `actions` reaches no runbook until a key uses it.

Show the groups by role, with the key and the change in one line (`delete removed`, `approve added`). Merge a runbook that appears under several keys into one row with all its keys. When no runbook is reached, say so and go to step 6.

Done when the user has seen every group.

## 5. Mark for review

Ask with `AskUserQuestion`: mark all, mark none, or pick some. On "pick some", ask which runbooks, multi-select in rounds of four, each with its role and keys in the label.

For each changed key, build the command for the chosen runbooks that the key reached:

`node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" mark-review <id...> --reason role-permissions --role <name> --key <key> --change "<one line>"`

Run it without `--write` first, show what it would add to each runbook, and ask whether to write. On a yes, run it again with `--write`.

Done when each chosen runbook has its entry, or the user chose none.

## 6. Show the change

Print, before any commit question:

- one line per key changed: old actions, new actions;
- the project actions added;
- the runbooks marked, with the reason and key, and the number left unmarked;
- the command that resolves each review: `/runbooks:update <id>`.

## 7. Commit

Commit `roles.json` and the marked runbooks by the `runbooks` policy. Ask an `ask` question only after the summary from step 6 is on screen; the question names the files and the message and does not repeat the summary.

Write in the config `language`.

Done when the user has seen the diff before the write and the summary before any commit question.
