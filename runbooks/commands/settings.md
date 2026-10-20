---
description: Change what setup configured (stack, test libraries, design reference, app, accounts, viewports, sources, git and commit policy, MCP servers)
argument-hint: "[group ...]"
disable-model-invocation: true
---

# Runbook settings

Arguments: `$ARGUMENTS`

## Parameters

| Parameter | Use |
|---|---|
| `[group ...]` | optional: the groups to change, by the names in the table of step 2 (`design`, `commits`). Without it, the command shows the current settings and asks what to change |

Examples: `/runbooks:settings`, `/runbooks:settings design`, `/runbooks:settings stack tests`.

Changes one part of a project that `/runbooks:setup` already prepared, without going through every setup question again. It changes the config and the files that depend on the changed keys, shows the diff of every file before writing, and writes only after the user approves.

Read first: `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/config.md` and `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/commits.md`. The questions and the detection for each group are the ones in `${CLAUDE_PLUGIN_ROOT}/commands/setup.md`; this command asks only those of the chosen groups.

Run `git status --porcelain` now and keep the list: a file that is already dirty changes how its commit works (`commits.md`).

## 1. Read the current settings

1. Read `docs/runbooks/runbooks.config.json`. When it is missing, offer `/runbooks:setup` and stop; when `docs/runbooks/runbook.config.json` exists instead, say that setup migrates it from the old plugin name. When it has no `stack` or still has `paths.e2e`, say that `/runbooks:setup` migrates it, offer it, and stop.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" list --json` and keep, per runbook, its `surface`, `roles`, `viewports`, `design`, `upstream` and `problems`. Step 3 uses them to find runbooks a change breaks.
3. Read the `mcpServers` of `.mcp.json`, when it exists.

Done when you hold the config, the runbook list and the MCP servers.

## 2. Choose what to change

When `$ARGUMENTS` names groups, skip to step 3 with them. An unknown name gets the list of groups.

Otherwise print the current value of every group in a table, in the config `language`, with values the stack does not use left out (a `backend` stack has no design, app, accounts or viewports), and ask with `AskUserQuestion`, multi-select, which groups to change. It takes four options: offer Stack and tests, Design, Commits and git, and the group that fits the project best among the others; the user names any other group under "Other".

| Group | Keys |
|---|---|
| `language` | `language` |
| `stack` | `stack`, and the `tests.<surface>` blocks it adds or removes |
| `tests` | `tests.<surface>`: `tech`, `framework`, `dir`, `command`, `root`, `baseUrl` |
| `design` | `design`, and its server in `.mcp.json`. Only with `ui` |
| `app` | `app.baseUrl`, `app.start`, `uiText`, `data.seedHint` |
| `accounts` | `accounts.<role>`. Only with `ui` |
| `viewports` | `viewports.<name>`. Only with `ui` |
| `sources` | `entries`, `requirements`, `slices` |
| `tickets` | `tickets.fetch` |
| `git` | `git.base`, `git.protected`, `git.messageFormat` |
| `commits` | `commits.runbooks`, `commits.setup` |
| `upstream` | every `upstream.*` key: `mode`, `baseUrl`, `start`, `root`, `urlEnv`, `port`, `fixtures`, `schema`, `redactHeaders`, `tokenEnv`, `serverFile`. Only with `ui` |
| `ui` | `staleDays` |
| `mcp` | `mcp.headless`, `mcp.headed`, `mcp.secretsFile`, `paths.evidence`, and the two Playwright servers in `.mcp.json`. Only with `ui` |

`paths.runbooks` is not in any group: the config lives at `docs/runbooks/runbooks.config.json` whatever it says, and moving the runbooks means moving their reports and ignore rules too. When the user asks for it, say so and stop.

Done when you hold the groups to change.

## 3. Ask the new values

Ask with `AskUserQuestion`, in rounds of four, each question with the current value as the recommended option ("Keep `<value>`"). Ask the questions `setup.md` step 2 asks for those keys, with its detection from step 1 where a question needs it (installed test libraries, design links, breakpoints). A key the user wants to clear takes its default from `config.md`.

Some changes reach past their own key. Work out each one from the table below, ask what it needs, and add its files to the write list:

| Change | Also |
|---|---|
| `stack` gains `ui` | ask the design, `app.baseUrl`, `app.start`, `accounts` and the Playwright MCP servers, as setup does; `tests.ui` stays optional |
| `stack` gains `api` | ask `tests.api`, which is required; fill the API scripts checklist of the agents block (`setup.md` step 3); say that endpoint coverage drops on the next `/runbooks:coverage`, because endpoints then count only through `api` runbooks (`references/coverage.md`, By surface) |
| `stack` loses a surface | remove `tests.<surface>`. Losing `ui` sets `design` to `null`, removes the `upstream` block in the same write (the loader rejects `upstream` in a stack without `ui`) and offers to remove the two Playwright servers from `.mcp.json`; losing `api` removes the API scripts checklist from the agents block. List the runbooks of that surface: they become invalid, and the user decides whether to deprecate them (`/runbooks:update`) or keep the stack |
| `tests.<surface>.framework` | install it when missing, after a yes, as setup does; `dir` and `command` follow the new framework. List the runbooks whose `scripts` belong to the old one: their scripts no longer run with the new command, and `/runbooks:to-test` rewrites them |
| `tests.<surface>.command` or `root` | run the test check of `setup.md` step 3 before writing the config |
| `tests.api` changes how scripts are written | refill the API scripts checklist of the agents block |
| `design.system` or `design.mcp` | write or replace the design server in `.mcp.json` from `${CLAUDE_PLUGIN_ROOT}/templates/design-servers.json` (`setup.md` step 3); offer to remove the old server when no other key names it. List the runbooks with `design` references: references of the old system no longer open, and `/runbooks:update` relinks them |
| `design` becomes `null` | list the runbooks with `design` references: they become invalid until `/runbooks:update` removes them |
| a viewport renamed or removed | list the runbooks that cite it in `viewports`, in a `Viewports:` line or in a `design` key `<name>.<viewport>`; offer to apply the rename to them in the same write |
| an account role renamed or removed | list the runbooks that cite it in `roles` or `As:`; offer to apply the rename to them in the same write |
| `mcp.secretsFile` or `paths.evidence` | rewrite the arguments of the two Playwright servers in `.mcp.json`; confirm the secrets file is ignored with `git check-ignore -q <file>`, and stop when it is not. A new `paths.evidence` must be ignored too |
| `mcp.headless` or `mcp.headed` | rename the server in `.mcp.json` |
| `upstream.mode` | list the `ui` runbooks whose effective mode changes: those with no `upstream:` in their frontmatter, whose `upstream` in the list differs from the new default. Offer `/runbooks:update <id>` for each, because `update` records or deletes the fixtures and rewrites the steps (`references/upstream.md`, Changing a runbook's mode). When the new default is `mocked`, say that endpoints then count only through `live` runbooks. When it is `live`, say that the fixtures stay on disk until `update` deletes them |
| `upstream.serverFile` or `tests.ui.dir` changes while `tests.ui` exists and `serverFile` is set, or `upstream.mode` becomes `mocked` (or the first mocked runbook appears) while `serverFile` is null | copy `${CLAUDE_PLUGIN_ROOT}/scripts/upstream-server.mjs` to `<tests.ui.dir>/runbooks-upstream.mjs` and write that path to `upstream.serverFile`. Show the diff before overwriting an existing file. An old copy at a previous path stays in place, because the plugin deletes no project file; name it in the summary so the user can delete it. Show the framework start command again, as `setup.md` step 3 does |
| `git.base` or `git.protected` | confirm each branch exists with `git rev-parse --verify` |

A runbook rename goes into the `runbooks` commit, not the `setup` one.

Done when every chosen key has a new value or was kept, and every file the changes reach is on the write list.

## 4. Write

Show the diff of every file on the write list and ask whether to write it. Write only after a yes; on a no, write nothing and stop.

Then validate:

- `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" entries` and `... requirements` exit 0, and every warning is understood. Fix the config until they do.
- `... list --json`: compare `problems` with step 1. A runbook with a new problem is one the table of step 3 listed; when it is not, fix the config or tell the user.

Done when the files are written and the script runs clean, or every new problem is on the list the user saw.

## 5. Show the change

Print, before any commit question:

- one line per key changed, old value and new value;
- the files written, each marked created or updated;
- the runbooks the change made invalid or stale, each with the command that fixes it;
- when the server copy moved: the old path, left in place for the user to delete;
- when `.mcp.json` changed: that new servers load in a new session or through `/mcp`, and what the design server needs before its first use (`setup.md` step 6).

## 6. Commit

Commit the config, the agents block and `.mcp.json` by the `setup` policy, and the runbooks renamed in step 3 by the `runbooks` policy. Ask an `ask` question only after the summary from step 5 is on screen; the question names the files and the message and does not repeat the summary.

Write in the config `language`.

Done when the user has seen what changed before any commit question.
