---
description: Answer a question about the runbooks plugin, from its own docs, optionally limited to one area
argument-hint: "[--about area] [\"question\"]"
disable-model-invocation: true
---

# Runbooks help

Arguments: `$ARGUMENTS`

## Parameters

| Parameter | Use |
|---|---|
| `--about area` | optional: the area of the question, by the names in the table of step 1 (`roles`, `upstream`, `coverage`). Without it, the command picks the area from the question |
| `"question"` | optional: what the user wants to know, in any language. Without it, the command explains the area: what it is, the terms it uses and its commands |

Examples: `/runbooks:help`, `/runbooks:help --about roles "How roles work?"`, `/runbooks:help --about upstream`, `/runbooks:help "Why does my mocked runbook not count as coverage?"`.

Read-only. It runs no runbook, writes no file and commits nothing. It answers from the plugin's files, not from memory: every claim comes from a file this command read.

## 1. Choose the area

| Area | Read |
|---|---|
| `overview` | `README.md`, `skills/runbooks/SKILL.md`, `CONTEXT.md`, `templates/readme.md` |
| `format` | `skills/runbooks/references/format.md`, `templates/runbook.md`, `templates/runbook-api.md`, `templates/placeholder.md` |
| `lifecycle` | `templates/readme.md` (Lifecycle), `skills/runbooks/references/format.md` (Status, Placeholders, Step states), `commands/map.md`, `commands/create.md`, `commands/update.md` |
| `scenarios` | `skills/scenarios/SKILL.md`, `commands/create.md` |
| `config` | `skills/runbooks/references/config.md`, `commands/setup.md`, `commands/settings.md`, `docs/adr/0007-ui-tests-may-live-in-another-repo.md` |
| `run` | `skills/runbooks/references/run-modes.md`, `commands/run.md`, `commands/check.md` |
| `scripts` | `commands/to-test.md`, `skills/runbooks/references/format.md` (What a step can verify, Scripts of api runbooks), `docs/adr/0001-api-runbooks-run-through-their-script.md`, `docs/adr/0007-ui-tests-may-live-in-another-repo.md` |
| `coverage` | `skills/runbooks/references/coverage.md`, `commands/coverage.md`, `docs/adr/0002-endpoint-coverage-by-surface.md`, `docs/adr/0004-mocked-runbooks-never-cover-endpoints.md` |
| `audit` | `commands/audit-runbooks.md`, `commands/list.md` (`--affected`) |
| `upstream` | `skills/runbooks/references/upstream.md`, `docs/adr/0003-mocked-upstream-served-by-plugin-server.md`, `docs/adr/0004-mocked-runbooks-never-cover-endpoints.md`, `docs/adr/0005-upstream-api-in-another-repo-is-a-contract.md` |
| `design` | `skills/runbooks/references/config.md` (Design), `skills/runbooks/references/run-modes.md` (Design), `skills/runbooks/references/format.md` (Frontmatter) |
| `viewports` | `skills/runbooks/references/config.md` (Viewports), `skills/runbooks/references/run-modes.md` (Viewports) |
| `roles` | `skills/runbooks/references/config.md` (Roles), `skills/runbooks/references/format.md` (Roles, Review), `skills/runbooks/references/run-modes.md` (Roles), `skills/runbooks/references/coverage.md` (By role), `commands/roles/*.md` |
| `contexts` | `skills/runbooks/references/config.md` (Roles), `skills/runbooks/references/format.md` (Contexts and cases), `skills/runbooks/references/upstream.md` (Case layer), `docs/adr/0006-a-case-is-a-run-dimension-inside-a-role.md`, `commands/contexts/*.md` |
| `permissions` | `skills/runbooks/references/config.md` (Roles), `commands/permissions/manage.md`, `commands/roles/generate.md` |
| `commits` | `skills/runbooks/references/commits.md` |
| `commands` | the `## Parameters` section and the opening paragraphs of every file in `commands/` |

Every path is under `${CLAUDE_PLUGIN_ROOT}`.

1. With `--about`, take its area. A name that is a command (`run`, `coverage`) or a term from `CONTEXT.md` (`case`, `outcome`, `surface`) maps to the area that holds it. An unknown name gets the list of areas, with the closest ones first, and the command stops.
2. Without `--about`, pick the area from the question: the terms of `CONTEXT.md` it uses and the commands it names. When two areas fit, read both. When nothing fits, use `overview`.
3. Without `--about` and without a question, print the areas with one line each on what they explain, then the example `/runbooks:help --about roles "How roles work?"`, and stop.

Done when you hold the area, or the command stopped with the list of areas.

## 2. Read

1. Read `${CLAUDE_PLUGIN_ROOT}/CONTEXT.md` and the files of the area. In a long reference, read the sections the table names, then the other sections the question reaches.
2. Follow a link or a file name in those files when the question needs it, for example an ADR a reference cites or a command a reference names.
3. When `docs/runbooks/runbooks.config.json` exists in the project, read it. It tells which parts apply here: the `stack`, whether `roles.enabled` is on, the default `upstream.mode`. Read the project's `roles.json` or a runbook only when the question is about this project ("Which roles do I have?", "Why is `billing.issue-invoice` stale?"), and prefer the script for it: `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" roles`, `... list`, `... check <id>`.

Done when you hold the passages that answer the question.

## 3. Answer

Write in the language of the question. Without a question, use the config `language`, else English. Terms of `CONTEXT.md`, frontmatter keys, command names and file names stay as they are.

- Answer the question first, in a few sentences, with the terms of `CONTEXT.md`.
- Then add what the user needs to act on it: an example in the runbook or config format, copied or adapted from the references, and the commands that do the work, with their parameters.
- When the project config changes the answer, say how. For example, with `roles.enabled` off, say that the roles behavior does not apply until `/runbooks:settings roles` turns tracking on.
- Without a question, explain the area: what it is for, its terms, how its pieces relate, and its commands.
- End with the files the answer came from, each with its section, so the user can read further.

When the files do not answer the question, say so and say what they cover instead. Do not fill the gap with a guess. When the answer depends on the script's behavior and no reference describes it, read `${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs` or its `lib/` and say the answer came from the code.

Done when the user has the answer, or knows that the plugin's files do not have one, and has the files to read further.
