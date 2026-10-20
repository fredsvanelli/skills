---
name: runbooks
description: Runbooks are the project's UAT knowledge base in docs/runbooks/, verified in the browser (ui runbooks) or through their test scripts (api runbooks). Use when writing, updating, running or auditing a runbook, when measuring runbook coverage, and before calling feature work done in a project that has docs/runbooks/runbooks.config.json.
---

# Runbooks

A runbook is a versioned UAT script for one flow: preconditions, ordered steps, and the exact result expected after each step. Its `surface` says where that result is verified: `ui` in the browser, `api` through the runbook's test script, which the plugin writes or adopts and then runs with the project's test command. Runbooks are the project's official record of how the product behaves. Each execution produces a separate report in `_runs/`, kept local and ignored by Git, and rewrites `runs.json` and `runs.html`, the local table of every runbook's last full run; the runbook itself changes only when the expected behavior changes.

## Commands

Each command file holds the full procedure. When the user asks for one of these in their own words, read the file and follow it as if they had typed the command.

| Request | Command | File |
|---|---|---|
| prepare a project for runbooks | `/runbooks:setup` | `${CLAUDE_PLUGIN_ROOT}/commands/setup.md` |
| change part of the runbook config: stack, test library, design reference, accounts, viewports, commit policy, ... | `/runbooks:settings` | `${CLAUDE_PLUGIN_ROOT}/commands/settings.md` |
| find runbooks, or the ones a change affects | `/runbooks:list` | `${CLAUDE_PLUGIN_ROOT}/commands/list.md` |
| map the code into placeholder runbooks for the flows no runbook cites | `/runbooks:map` | `${CLAUDE_PLUGIN_ROOT}/commands/map.md` |
| write a new runbook from a spec, diff, ticket, description, code file, directory, route or placeholder | `/runbooks:create` | `${CLAUDE_PLUGIN_ROOT}/commands/create.md` |
| change the steps of an existing runbook after the behavior changed | `/runbooks:update` | `${CLAUDE_PLUGIN_ROOT}/commands/update.md` |
| execute runbooks, or produce a prompt for the Chrome extension | `/runbooks:run` | `${CLAUDE_PLUGIN_ROOT}/commands/run.md` |
| see the result of a runbook's latest run, or whether it ever ran | `/runbooks:check` | `${CLAUDE_PLUGIN_ROOT}/commands/check.md` |
| write or adopt the test script of a runbook (Playwright, Cypress, Jest, Vitest, PHPUnit, Pest, ...) | `/runbooks:to-test` | `${CLAUDE_PLUGIN_ROOT}/commands/to-test.md` |
| check runbooks still match the code | `/runbooks:audit-runbooks` | `${CLAUDE_PLUGIN_ROOT}/commands/audit-runbooks.md` |
| measure coverage | `/runbooks:coverage` | `${CLAUDE_PLUGIN_ROOT}/commands/coverage.md` |
| update the installed runbooks plugin to its latest version | `/runbooks:upgrade` | `${CLAUDE_PLUGIN_ROOT}/commands/upgrade.md` |

Before calling feature work done, run `list --affected` and then `run` on what it returns.

## Rules for every command

- Read `docs/runbooks/runbooks.config.json` first. When it is missing, run setup.
- Verify `ui` results in the browser, and only there. Verify `api` results only through the runbook's script, run by the project's test command (`references/format.md`, "What a step can verify"). The agent reads no database, writes no SQL, and confirms no result through a direct HTTP call. A behavior the surface cannot show goes under "Not covered" in the runbook, with the reason.
- Read the config `stack` and each runbook's `surface` before acting: several commands branch on them.
- Refer to credentials by env var name. The only read of a `.env*` file is `grep -c '^NAME=' <file>`, which checks that a key exists; print no secret value.
- Write runbook and report prose in the config `language`. Section headings and frontmatter keys stay in English.
- Let the script compute what it can: `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" --help`. When Node 18+ is missing, do the same work by hand and say in the output that the agent counted it.
- Commit as `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/commits.md` says.

## Reference

- Runbook format, step states, dependency tree, status rules: `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/format.md`
- Config fields: `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/config.md`
- Run modes: `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/run-modes.md`
- Coverage: `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/coverage.md`
- Commit policy: `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/commits.md`
