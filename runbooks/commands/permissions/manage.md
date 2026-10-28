---
description: Change what a role may do on each capability/feature key, then mark the runbooks the change reaches for review
argument-hint: "<name> [--model <model>]"
disable-model-invocation: true
---

# Manage a role's permissions

Before following this procedure, read [runtime setup](../../skills/runbooks/references/runtime.md). Resolve the plugin root from this file's real location and use the active host's tools and argument handling. Do this also when this entry is invoked directly.

Arguments: `$ARGUMENTS`

## Parameters

| Parameter | Use |
|---|---|
| `<name>` | the role to change. Required. `anonymous` is allowed, and its matrix usually stays empty |
| `--model m` | run this command in a sub-agent on that model: `inline` (the main session runs it, the default), `haiku`, `sonnet`, `opus` or `fable` on Claude; `inherit` or an available model ID on Codex |

Examples: `/runbooks:permissions:manage editor`, `/runbooks:permissions:manage manager`.

Edits `<paths.runbooks>/roles.json` and marks affected runbooks with `review`. `create` runs the same questions for a new role (step 2). Read first: `${RUNBOOKS_PLUGIN_ROOT}/skills/runbooks/references/config.md`, "Roles", and `${RUNBOOKS_PLUGIN_ROOT}/skills/runbooks/references/format.md`, "Review". Commit policy: `${RUNBOOKS_PLUGIN_ROOT}/skills/runbooks/references/commits.md`.

Run `git status --porcelain` now and keep the list for the commit step.

## Model

With `--model` set to a value other than `inline`, follow "Dispatch steps" in `${RUNBOOKS_PLUGIN_ROOT}/skills/runbooks/references/agents.md` with this file as the instructions file, and the sub-agent skips this section. Otherwise follow the file below as usual.

## 1. Load the role

1. Read `docs/runbooks/runbooks.config.json`. When it is missing, offer `/runbooks:setup` and stop. When `roles.enabled` is not true, say that role tracking is off, offer `/runbooks:settings roles`, and stop.
2. Without `<name>`, run `node "${RUNBOOKS_PLUGIN_ROOT}/scripts/runbooks.mjs" roles`, show the roles, and ask which one with `AskUserQuestion`. A name the registry does not have gets the same list.
3. Run `node "${RUNBOOKS_PLUGIN_ROOT}/scripts/runbooks.mjs" roles <name>` and show the effective matrix: each key (one row per case for a key of a context), its actions, whether they are the role's own, inherited from a role or overridden, and the keys marked `guess`.
4. Read `roles.json`. Keep the `actions` list: the four base actions (`view`, `create`, `edit`, `delete`) plus the project's.

Done when the user has seen the effective matrix and you hold the registry.

## 2. Ask what changes

Ask with `AskUserQuestion`, in rounds of four. First ask which kind of change:

- change the actions of a key;
- add a key;
- remove a key;
- add a project action to `actions`.

"Other" ends the loop. Repeat until the user has nothing more to change. Then ask the details of each kind. Contexts and cases are not created here: offer `/runbooks:contexts:create` for a new context and `/runbooks:contexts:update` for a new case.

- Change the actions of a key. Offer the keys of the effective matrix, then ask the actions the role has on the key, multi-select over the registry's `actions`, with the current ones as the recommended answer. On a key that belongs to a context, ask first whether the actions are the same in every case. On a yes, ask one list and write it as a list. On a no, ask the actions of each case of the context, one question per case, and write them as a map. A case the user leaves with no action stays in the map as an empty list, so the no access is explicit. Changing a key the role only inherits writes an own entry that replaces the inherited one (`config.md`, "Inheritance and override"). Removing every action writes an empty list, which overrides the parent and leaves the role without access.
- Add a key. Ask `<capability>/<feature>` or `<capability>/*`, with the names of the runbook frontmatter. Offer the keys of `node "${RUNBOOKS_PLUGIN_ROOT}/scripts/runbooks.mjs" list --json` that no entry of this role covers. Then ask its actions as above.
- Remove a key. Offer the role's own keys. An inherited key is not removed here: say so, and offer an own entry with an empty list instead.
- Add a project action. Ask for the identifier. It is English, lowercase and not one of the base four. It goes into the top-level `actions` list, and the user can then give it to keys.

A key the user edits loses its `origins` entry, because the user's answer replaces what the scanner deduced. A key the user adds has none.

Done when you hold every change, as old actions and new actions per key.

## 3. Show the diff and write

Show the diff of `roles.json` and ask whether to write it. Write only after a yes; on a no, write nothing and stop. Keep the file's key order, with `version` first.

Then run `node "${RUNBOOKS_PLUGIN_ROOT}/scripts/runbooks.mjs" roles <name>`. When the script reports a registry error, fix the file until it loads, or restore it with `git checkout -- <path>` after telling the user.

Done when `roles.json` is written and the script loads it.

## 4. Find the affected runbooks

For each key whose actions changed, or that was added or removed:

`node "${RUNBOOKS_PLUGIN_ROOT}/scripts/runbooks.mjs" roles --affected --role <name> --key <key> [--case <case>]`

For a change in one case, pass `--case <case>`: it keeps the runbooks that run that case. For a change in several cases, run it once per case. It lists the runbooks of the role and of the roles that inherit from it, grouped by role. A new project action in `actions` reaches no runbook until a key uses it.

Show the groups by role, with the key and the change in one line (`delete removed`, `approve added`; `vip-outside: edit removed` for one case). Merge a runbook that appears under several keys into one row with all its keys. When no runbook is reached, say so and go to step 6.

Done when the user has seen every group.

## 5. Mark for review

Ask with `AskUserQuestion`: mark all, mark none, or pick some. On "pick some", ask which runbooks, multi-select in rounds of four, each with its role and keys in the label.

For each changed key, build the command for the chosen runbooks that the key reached:

`node "${RUNBOOKS_PLUGIN_ROOT}/scripts/runbooks.mjs" mark-review <id...> --reason role-permissions --role <name> --key <key> [--case <case>] --change "<one line>"`

For a change in one case, add `--case <case>` and name the case in the line, as in `vip-outside: edit removed`.

Run it without `--write` first, show what it would add to each runbook, and ask whether to write. On a yes, run it again with `--write`.

Done when each chosen runbook has its entry, or the user chose none.

## 6. Show the change

Print, before any commit question:

- one line per key changed, and per case for a key of a context: old actions, new actions;
- the project actions added;
- the runbooks marked, with the reason and key, and the number left unmarked;
- the command that resolves each review: `/runbooks:update <id>`.

Done when the user has seen this summary.

## 7. Commit

Commit `roles.json` and the marked runbooks by the `runbooks` policy. Ask an `ask` question only after the summary from step 6 is on screen; the question names the files and the message and does not repeat the summary.

Write in the config `language`.

Done when the user has seen the diff before the write and the summary before any commit question.

## 8. Close

Give the commit outcome: the short sha, or the paths left uncommitted. Then offer `/runbooks:update <id>` for each runbook marked for review, which writes the role lines and clears the review.
