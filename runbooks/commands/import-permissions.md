---
description: Import a permissions CSV into roles.json, then mark the runbooks the changes reach for review
argument-hint: "[file]"
disable-model-invocation: true
---

# Import permissions

Arguments: `$ARGUMENTS`

## Parameters

| Parameter | Use |
|---|---|
| `[file]` | the CSV to read, relative to the project root, in the format `/runbooks:export-permissions` writes. Default: `permissions.csv` |

Examples: `/runbooks:import-permissions`, `/runbooks:import-permissions docs/permissions.csv`.

Edits `<paths.runbooks>/roles.json` and marks affected runbooks with `review`. The CSV replaces the matrix of each role it has rows for; a role with no row keeps its matrix. It changes no role's description, parents or account. Read first: `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/config.md`, "Roles", and `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/format.md`, "Review". Commit policy: `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/commits.md`.

Run `git status --porcelain` now and keep the list for the commit step.

## 1. Check that tracking is on

Read `docs/runbooks/runbooks.config.json`. When it is missing, offer `/runbooks:setup` and stop. When `roles.enabled` is not true, say that role tracking is off, offer `/runbooks:settings roles`, and stop.

Use `[file]`, or `permissions.csv` at the project root. When the file does not exist, say so, offer `/runbooks:export-permissions`, and stop.

Done when tracking is on and the CSV exists.

## 2. Plan the import

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" import-permissions --file <file>`. It writes nothing and prints:

- one row per key that changes: role, key, actions before and after. `absent` before means the CSV adds the key, `absent` after means the CSV dropped its row, and `none` is a key kept with no access;
- the project actions the CSV adds as new columns;
- the roles with no row, which keep their matrix;
- `missingCases`: for a role and key with case rows for only some cases, the cases left without access. Show them, because the import writes a map with only the cases the CSV has.

On exit 2, the message names the line and column of the problem (an unregistered role, a bad key, a repeated row, a cell that is not `x` or empty, a missing action column) or the registry error the result would raise. Show it, say to fix the CSV and run the command again, and stop. A role the registry does not have is added with `/runbooks:roles:create` first. With contexts, the case errors and their fixes are:

- `line 1: the registry has contexts, so the header needs a "case" column`. Add the column after `key`.
- `<role> "<key>" mixes a row with no case and rows with cases`. Use one empty-case row or case rows, not both.
- `case "<c>" is not a case of <context>`. Fix the name.
- `key "<key>" belongs to no context, so its case must be empty`. Clear the cell.
- `case "<c>" is not registered; /runbooks:roles:manage-contexts adds it`. The import never creates a context or a case, so run that command first.

When the script prints `Nothing to change.`, say that `roles.json` already matches the CSV and stop.

Show the rows. Call out each removed key and each key kept with no access, because they take access away from the role and from the roles that inherit from it.

Done when the user has seen every change.

## 3. Write

Ask with `AskUserQuestion` whether to write. Write only after a yes; on a no, write nothing and stop.

Run the same command with `--write --json` and keep its `changes` list for the next steps. Each key the import adds, changes or removes loses its `origins` entry, because the CSV replaces what the scanner deduced; an unchanged key keeps it. The script writes `roles.json` with two-space indentation and keeps the key order, with `version` first.

Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" roles`. When it reports a registry error, restore the file with `git checkout -- <path>` after telling the user, and stop.

Done when `roles.json` is written and the script loads it.

## 4. Find the affected runbooks

For each entry of `changes`:

`node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" roles --affected --role <role> --key <key> [--case <case>]`

For a change in one case, pass `--case <case>`. It lists the runbooks of the role and of the roles that inherit from it, grouped by role. A new project action reaches no runbook until a key uses it.

Show the groups by role, with the key and the change in one line (`delete removed`, `approve added`, `key added`, `key removed`). Merge a runbook that appears under several keys or roles into one row with all of them. When no runbook is reached, say so and go to step 6.

Done when the user has seen every group.

## 5. Mark for review

Ask with `AskUserQuestion`: mark all, mark none, or pick some. On "pick some", ask which runbooks, multi-select in rounds of four, each with its roles and keys in the label.

For each changed role and key, build the command for the chosen runbooks it reached:

`node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" mark-review <id...> --reason role-permissions --role <role> --key <key> [--case <case>] --change "<one line>"`

Run them without `--write` first, show what they would add to each runbook, and ask whether to write. On a yes, run them again with `--write`.

Done when each chosen runbook has its entries, or the user chose none.

## 6. Show the change

Print, before any commit question:

- one line per role and key changed: old actions, new actions;
- the project actions added;
- the roles left as they were;
- the runbooks marked, with the reason, role and key, and the number left unmarked;
- the command that resolves each review: `/runbooks:update <id>`.

Done when the user has seen this summary.

## 7. Commit

Commit `roles.json` and the marked runbooks by the `runbooks` policy. The CSV is not committed. Ask an `ask` question only after the summary from step 6 is on screen; the question names the files and the message and does not repeat the summary.

Write in the config `language`.

Done when the user has seen the changes before the write and the summary before any commit question.

## 8. Close

Give the commit outcome: the short sha, or the paths left uncommitted. Say that the CSV stays in the working tree and can be deleted. Then offer `/runbooks:update <id>` for each runbook marked for review, which writes the role lines and clears the review.
