---
name: runbook
description: Runbooks are the project's UAT knowledge base in docs/runbooks/, verified in the browser. Use when writing, updating, running or auditing a runbook, when measuring runbook coverage, and before calling feature work done in a project that has docs/runbooks/runbook.config.json.
---

# Runbooks

A runbook is a versioned UAT script for one user flow: preconditions, ordered steps, and the exact result the browser shows after each step. Runbooks are the project's official record of how the product behaves. Each execution produces a separate report in `_runs/`, kept local and ignored by Git, and rewrites `runs.json` and `runs.html`, the local table of every runbook's last full run; the runbook itself changes only when the expected behavior changes.

## Commands

Each command file holds the full procedure. When the user asks for one of these in their own words, read the file and follow it as if they had typed the command.

| Request | Command | File |
|---|---|---|
| prepare a project or change its runbook config | `/runbook:setup` | `${CLAUDE_PLUGIN_ROOT}/commands/setup.md` |
| find runbooks, or the ones a change affects | `/runbook:list` | `${CLAUDE_PLUGIN_ROOT}/commands/list.md` |
| map the code into placeholder runbooks for the flows no runbook cites | `/runbook:map` | `${CLAUDE_PLUGIN_ROOT}/commands/map.md` |
| write a new runbook from a spec, diff, ticket, description or placeholder | `/runbook:create` | `${CLAUDE_PLUGIN_ROOT}/commands/create.md` |
| change the steps of an existing runbook after the behavior changed | `/runbook:update` | `${CLAUDE_PLUGIN_ROOT}/commands/update.md` |
| execute runbooks, or produce a prompt for the Chrome extension | `/runbook:run` | `${CLAUDE_PLUGIN_ROOT}/commands/run.md` |
| see the result of a runbook's latest run, or whether it ever ran | `/runbook:check` | `${CLAUDE_PLUGIN_ROOT}/commands/check.md` |
| turn a runbook into a Playwright spec | `/runbook:to-test` | `${CLAUDE_PLUGIN_ROOT}/commands/to-test.md` |
| check runbooks still match the code | `/runbook:audit-runbook` | `${CLAUDE_PLUGIN_ROOT}/commands/audit-runbook.md` |
| measure coverage | `/runbook:coverage` | `${CLAUDE_PLUGIN_ROOT}/commands/coverage.md` |
| update the installed runbook plugin to its latest version | `/runbook:upgrade` | `${CLAUDE_PLUGIN_ROOT}/commands/upgrade.md` |

Before calling feature work done, run `list --affected` and then `run` on what it returns.

## Rules for every command

- Read `docs/runbooks/runbook.config.json` first. When it is missing, run setup.
- Verify results in the browser, and only there. The skillset reads no database, writes no SQL, and confirms no result through a direct HTTP call. A behavior the UI does not show goes under "Not covered" in the runbook, with the reason.
- Refer to credentials by env var name. The only read of a `.env*` file is `grep -c '^NAME=' <file>`, which checks that a key exists; print no secret value.
- Write runbook and report prose in the config `language`. Section headings and frontmatter keys stay in English.
- Let the script compute what it can: `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbook.mjs" --help`. When Node 18+ is missing, do the same work by hand and say in the output that the agent counted it.
- Commit as `${CLAUDE_PLUGIN_ROOT}/skills/runbook/references/commits.md` says.

## Reference

- Runbook format, step states, dependency tree, status rules: `${CLAUDE_PLUGIN_ROOT}/skills/runbook/references/format.md`
- Config fields: `${CLAUDE_PLUGIN_ROOT}/skills/runbook/references/config.md`
- Run modes: `${CLAUDE_PLUGIN_ROOT}/skills/runbook/references/run-modes.md`
- Coverage: `${CLAUDE_PLUGIN_ROOT}/skills/runbook/references/coverage.md`
- Commit policy: `${CLAUDE_PLUGIN_ROOT}/skills/runbook/references/commits.md`
