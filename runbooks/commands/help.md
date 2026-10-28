---
description: Answer a question about the runbooks plugin, from its own docs, optionally limited to one area
argument-hint: "[--about area] [\"question\"] [--model inline|haiku|sonnet|opus|fable]"
disable-model-invocation: true
---

# Runbooks help

Arguments: `$ARGUMENTS`

## Parameters

| Parameter | Use |
|---|---|
| `--about area` | optional: the area of the question, by the names in the "Areas" table below (`roles`, `upstream`, `coverage`). Without it, the command picks the area from the question |
| `"question"` | optional: what the user wants to know, in any language. Without it, the command explains the area: what it is, the terms it uses and its commands |
| `--model m` | force the model of the sub-agent this command launches: `inline` (the main session runs it), `haiku`, `sonnet`, `opus` or `fable` |

Examples: `/runbooks:help`, `/runbooks:help --about roles "How roles work?"`, `/runbooks:help --about upstream`, `/runbooks:help "Why does my mocked runbook not count as coverage?"`.

This file only dispatches. The procedure is in `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/instructions/help.md`. Dispatching follows `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/agents.md`: read it before step 2. It covers the model, the brief, the report, questions, calls, commits and a model that cannot launch.

## Areas

| Area | Read |
|---|---|
| `overview` | `README.md`, `skills/runbooks/SKILL.md`, `CONTEXT.md`, `templates/readme.md` |
| `format` | `skills/runbooks/references/format.md`, `templates/runbook.md`, `templates/runbook-api.md`, `templates/placeholder.md` |
| `lifecycle` | `templates/readme.md` (Lifecycle), `skills/runbooks/references/format.md` (Status, Placeholders, Step states), `skills/runbooks/instructions/map.md`, `skills/runbooks/instructions/create.md`, `skills/runbooks/instructions/update.md`, `commands/orchestrator.md` |
| `scenarios` | `skills/scenarios/SKILL.md`, `skills/runbooks/instructions/create.md` |
| `config` | `skills/runbooks/references/config.md`, `commands/setup.md`, `commands/settings.md`, `docs/adr/0007-ui-tests-may-live-in-another-repo.md` |
| `run` | `skills/runbooks/references/run-modes.md`, `commands/run.md`, `skills/runbooks/instructions/run.md`, `commands/check.md` |
| `scripts` | `skills/runbooks/instructions/to-test.md`, `skills/runbooks/references/format.md` (What a step can verify, Scripts of api runbooks), `docs/adr/0001-api-runbooks-run-through-their-script.md`, `docs/adr/0007-ui-tests-may-live-in-another-repo.md` |
| `coverage` | `skills/runbooks/references/coverage.md`, `skills/runbooks/instructions/coverage.md`, `docs/adr/0002-endpoint-coverage-by-surface.md`, `docs/adr/0004-mocked-runbooks-never-cover-endpoints.md` |
| `audit` | `skills/runbooks/instructions/audit.md`, `commands/list.md` (`--affected`) |
| `upstream` | `skills/runbooks/references/upstream.md`, `docs/adr/0003-mocked-upstream-served-by-plugin-server.md`, `docs/adr/0004-mocked-runbooks-never-cover-endpoints.md`, `docs/adr/0005-upstream-api-in-another-repo-is-a-contract.md`, `docs/adr/0011-the-agent-runs-the-projects-copy-of-the-upstream-server.md` |
| `design` | `skills/runbooks/references/config.md` (Design), `skills/runbooks/references/run-modes.md` (Design), `skills/runbooks/references/format.md` (Frontmatter) |
| `viewports` | `skills/runbooks/references/config.md` (Viewports), `skills/runbooks/references/run-modes.md` (Viewports) |
| `roles` | `skills/runbooks/references/config.md` (Roles), `skills/runbooks/references/format.md` (Roles, Review), `skills/runbooks/references/run-modes.md` (Roles), `skills/runbooks/references/coverage.md` (By role), `commands/roles/*.md`, `skills/runbooks/instructions/roles/generate.md` |
| `contexts` | `skills/runbooks/references/config.md` (Roles), `skills/runbooks/references/format.md` (Contexts and cases), `skills/runbooks/references/upstream.md` (Case layer), `docs/adr/0006-a-case-is-a-run-dimension-inside-a-role.md`, `commands/contexts/*.md` |
| `permissions` | `skills/runbooks/references/config.md` (Roles), `commands/permissions/manage.md`, `skills/runbooks/instructions/roles/generate.md` |
| `models` | `skills/runbooks/references/agents.md`, `skills/runbooks/references/config.md` (Models), `docs/adr/0010-each-command-runs-on-the-model-its-row-names.md` |
| `commits` | `skills/runbooks/references/commits.md` |
| `commands` | the `## Parameters` section and the opening paragraphs of every file in `commands/` |

Every path is under `${CLAUDE_PLUGIN_ROOT}`.

## Dispatch

1. Resolve the model with `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" model help [--about <area>] [--model <x>] [text]`, where `text` stands for the question, if any. When it prints `inline`, read `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/instructions/help.md` and follow it in this session. Otherwise follow "Dispatch steps" in `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/agents.md` with the command `help` and that instructions file; the sub-agent finds the areas table in this file, under "Areas".
2. Print the `summary:` of the report as written. It is the answer.

Done when the user has the answer.
