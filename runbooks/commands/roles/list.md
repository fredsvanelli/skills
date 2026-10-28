---
description: List the project's roles, or show one role with its effective permissions
argument-hint: "[name] [--json] [--model <model>]"
disable-model-invocation: true
---

# List roles

Before following this procedure, read [runtime setup](../../skills/runbooks/references/runtime.md). Resolve the plugin root from this file's real location and use the active host's tools and argument handling. Do this also when this entry is invoked directly.

Arguments: `$ARGUMENTS`

## Parameters

| Parameter | Use |
|---|---|
| `[name]` | show one role instead of the whole list: its effective permissions with the origin of each action, and its runbooks |
| `--json` | print the rows as JSON, for scripts |
| `--model m` | run this command in a sub-agent on that model: `inline` (the main session runs it, the default), `haiku`, `sonnet`, `opus` or `fable` on Claude; `inherit` or an available model ID on Codex |

Examples: `/runbooks:roles:list`, `/runbooks:roles:list manager`, `/runbooks:roles:list --json`.

Read-only. It writes nothing and commits nothing. The registry and the matrix: `${RUNBOOKS_PLUGIN_ROOT}/skills/runbooks/references/config.md`, "Roles".

## Model

With `--model` set to a value other than `inline`, follow "Dispatch steps" in `${RUNBOOKS_PLUGIN_ROOT}/skills/runbooks/references/agents.md` with this file as the instructions file, and the sub-agent skips this section. Otherwise follow the file below as usual.

## 1. Check that tracking is on

Read `docs/runbooks/runbooks.config.json`. When it is missing, offer `/runbooks:setup` and stop. When `roles.enabled` is not true, say that role tracking is off, offer `/runbooks:settings roles`, and stop.

Done when tracking is on, or the command stopped with that message.

## 2. Print

- Without a name: `node "${RUNBOOKS_PLUGIN_ROOT}/scripts/runbooks.mjs" roles`, or the same with `--json` when `$ARGUMENTS` has it. Print the table as the script gives it: name, description, inherits, account, runbook count, pending reviews, keys still marked `guess`, and the last results per role. When the registry has contexts, the table also has a Case keys column with the number of keys of the role that depend on a case.
- With a name: `node "${RUNBOOKS_PLUGIN_ROOT}/scripts/runbooks.mjs" roles <name>`. Print the effective permissions with the source of each row (own, inherited from a role, or overridden) and the role's runbooks. A key of a context has one row per case, with a Case column. A case the role's map leaves out shows no actions. A name the registry does not have gets the list of registered roles.

The script exits 2 with `role tracking is off; /runbooks:settings roles turns it on` when tracking is off. Show that message and stop.

## 3. Close

Below the output, say in one line each:

- a role with `guess` keys: `/runbooks:permissions:manage <name>` confirms or edits them;
- a role with pending reviews: `/runbooks:list --review` lists the runbooks, and `/runbooks:update <id>` clears each one;
- a role with no account on a `ui` project: `/runbooks:roles:update <name>` adds one.

Say only the lines that apply.

Done when the user has seen the rows the script printed.
