---
description: List the contexts of the role registry, or show one context with its runbooks
argument-hint: "[name] [--json] [--model inline|haiku|sonnet|opus|fable]"
disable-model-invocation: true
---

# List contexts

Arguments: `$ARGUMENTS`

## Parameters

| Parameter | Use |
|---|---|
| `[name]` | show one context instead of the whole list: its row and the runbooks on its keys |
| `--json` | print the rows as JSON, for scripts |
| `--model m` | run this command in a sub-agent on that model: `inline` (the main session runs it, the default), `haiku`, `sonnet`, `opus` or `fable` |

Examples: `/runbooks:contexts:list`, `/runbooks:contexts:list client-access`, `/runbooks:contexts:list --json`.

Read-only. It writes nothing and commits nothing. To change a context, use `/runbooks:contexts:create`, `/runbooks:contexts:update` or `/runbooks:contexts:delete`. Contexts and cases: `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/config.md`, "Roles".

## Model

With `--model` set to a value other than `inline`, follow "Dispatch steps" in `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/agents.md` with this file as the instructions file, and the sub-agent skips this section. Otherwise follow the file below as usual.

## 1. Check that tracking is on

Read `docs/runbooks/runbooks.config.json`. When it is missing, offer `/runbooks:setup` and stop. When `roles.enabled` is not true, say that role tracking is off, offer `/runbooks:settings roles`, and stop.

Done when tracking is on, or the command stopped with that message.

## 2. Print

- Without a name: `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" contexts`, or the same with `--json` when `$ARGUMENTS` has it. Print the table as the script gives it: context, description, keys, cases and runbook count. A registry with no contexts prints `No contexts.`
- With a name: `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" contexts <name>` prints the context's row. Then `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" contexts --affected <name>` prints the runbooks on its keys. Pass `--json` to both when `$ARGUMENTS` has it. A name the registry does not have makes the script exit 2 with `no context "<name>"`. Show that message and the table from a run without a name.

The script exits 2 with `role tracking is off; /runbooks:settings roles turns it on` when tracking is off. Show that message and stop.

## 3. Close

Below the output, say in one line each:

- a registry with no contexts: `/runbooks:contexts:create` creates the first one;
- otherwise: `/runbooks:contexts:update <name>` changes a context's keys, cases or description, and `/runbooks:contexts:delete <name>` removes it.

Say only the line that applies.

Done when the user has seen the rows the script printed.
