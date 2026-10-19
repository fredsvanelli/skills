---
description: Runbook coverage report, overall or per capability, feature, slice or path
argument-hint: "[--capability x | --feature y | --slice name | --path glob] [--all-slices]"
disable-model-invocation: true
---

# Runbook coverage

Arguments: `$ARGUMENTS`

## Parameters

Use at most one filter. Without one, the command writes the `overall` report.

| Parameter | Use |
|---|---|
| `--capability x` | entries whose file is in the slice `x` of the config `slices`; report `_coverage/capability-x.md` |
| `--slice name` | the same entries as `--capability`; report `_coverage/slice-name.md` |
| `--feature y` | entries and requirements cited by runbooks with `feature: y` |
| `--path glob` | entries whose file matches the glob (`src/app/**/financeiro/**`) |
| `--all-slices` | on its own: the `overall` report plus one report per slice in the config |

Slice and path filters reach entries only; requirements have no file to slice by.

Examples: `/runbook:coverage`, `/runbook:coverage --capability billing`, `/runbook:coverage --all-slices`.

Read first: `${CLAUDE_PLUGIN_ROOT}/skills/runbook/references/coverage.md`.

1. **Scopes.** No filter: `overall`. One filter: that scope. `--all-slices`: `overall` plus one `--slice <name>` per key of the config `slices`.
2. **Numbers.** For each scope, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbook.mjs" coverage <filter>` (Markdown) and `... coverage <filter> --json`. Exit code 2 stops the command; show the message.
3. **Suggestions.** From the JSON's uncovered entries and requirements, rank at most five runbooks to write first by the rules in `coverage.md`.
4. **Write** each report from `${CLAUDE_PLUGIN_ROOT}/templates/coverage-report.md` to `<paths.runbooks>/_coverage/<scope file name>`, with the script output pasted unchanged.
5. **Summary files.** Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbook.mjs" output --coverage` once, whatever the filter. It rewrites `<paths.runbooks>/runs.json` and `runs.html` (every runbook with its last full run) and `<paths.runbooks>/coverage.json` and `coverage.html` (the `overall` numbers). Keep them ignored by the rules in `${CLAUDE_PLUGIN_ROOT}/skills/runbook/references/commits.md`.
6. **Summarize** in the chat: the report paths, entry and requirement coverage per scope, orphan and invalid runbook counts, and the top suggestions.
7. **Close.** Offer `/runbook:create` for the first suggestion. Nothing is committed: `_coverage/` and the summary files are ignored by Git, so they stay local. End with links to `[coverage.html](file://<absolute path of <paths.runbooks>/coverage.html>)` and `[runs.html](file://<absolute path of <paths.runbooks>/runs.html>)`.

Done when every scope has its report file, the four summary files are rewritten, and the chat summary lists the same numbers.
