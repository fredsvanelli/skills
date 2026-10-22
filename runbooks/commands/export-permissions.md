---
description: Export the permission matrix of the roles to a CSV file, to edit in a spreadsheet and bring back with import-permissions
argument-hint: "[file] [--role r]"
disable-model-invocation: true
---

# Export permissions

Arguments: `$ARGUMENTS`

## Parameters

| Parameter | Use |
|---|---|
| `[file]` | the CSV to write, relative to the project root. Default: `permissions.csv` |
| `--role r` | export only the rows of role `r` |

Examples: `/runbooks:export-permissions`, `/runbooks:export-permissions docs/permissions.csv`, `/runbooks:export-permissions --role manager`.

Writes the CSV only. It leaves `roles.json` and the runbooks as they are and commits nothing. The registry and the matrix: `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/config.md`, "Roles".

## 1. Check that tracking is on

Read `docs/runbooks/runbooks.config.json`. When it is missing, offer `/runbooks:setup` and stop. When `roles.enabled` is not true, say that role tracking is off, offer `/runbooks:settings roles`, and stop.

With `--role r`, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" roles`. A name the registry does not have gets the list of registered roles, and the command stops.

Done when tracking is on and the role, if given, is registered.

## 2. Pick the file

Use `[file]`, or `permissions.csv` at the project root. When the file exists, ask with `AskUserQuestion`: overwrite it, write to another path (the user types it in "Other"), or stop. Stop on "stop".

Done when you hold a path the user agreed to write.

## 3. Write

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" export-permissions --out <file>`, with `--role r` when given. The script prints the number of rows it wrote. On exit 2, show its message and stop; it wrote nothing.

The CSV has one row per role and own key. It holds no inherited key, because the import writes each row back as an own entry. Its columns:

| Column | Holds |
|---|---|
| `role` | the role name |
| `key` | `<capability>/<feature>` or `<capability>/*` |
| one per action | `x` when the role has the action on the key, empty when not. The four base actions come first, then the project's |
| `origin` | `code`, `contract` or `guess`, empty when the user typed the key. The import ignores this column |

A role with no own key, usually `anonymous`, has no row.

Done when the script reported the file as written.

## 4. Close

Print:

- the path and the number of rows;
- the roles with no row;
- the keys marked `guess`, which are the ones worth checking first;
- how to edit the file: mark `x` to give an action and clear the cell to take it away, add a row to add a key, delete a row to remove the key, and clear every action cell of a row to keep the key with no access, which overrides what the parents give. A new column named after a lowercase English action (`approve`, `export`) adds that action to the project's `actions`. Keep the `role` and `key` columns and one column for each action the registry has. A spreadsheet that saves with `;` as the delimiter works too;
- the next step: `/runbooks:import-permissions <file>`.

Say that the CSV is not committed: it is a working copy, and `roles.json` stays the record.

Done when the user has seen the path and the editing rules.
