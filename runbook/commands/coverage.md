---
description: Runbook coverage report, overall or per capability, feature, slice or path
argument-hint: "[--capability x | --feature y | --slice name | --path glob] [--all-slices]"
disable-model-invocation: true
---

# Runbook coverage

Arguments: `$ARGUMENTS`

Read first: `${CLAUDE_PLUGIN_ROOT}/skills/runbook/references/coverage.md`.

Run `git status --porcelain` now and keep the list for the commit step.

1. **Scopes.** No filter: `overall`. One filter: that scope. `--all-slices`: `overall` plus one `--slice <name>` per key of the config `slices`.
2. **Numbers.** For each scope, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbook.mjs" coverage <filter>` (Markdown) and `... coverage <filter> --json`. Exit code 2 stops the command; show the message.
3. **Suggestions.** From the JSON's uncovered entries and requirements, rank at most five runbooks to write first by the rules in `coverage.md`.
4. **Write** each report from `${CLAUDE_PLUGIN_ROOT}/templates/coverage-report.md` to `<paths.runbooks>/_coverage/<scope file name>`, with the script output pasted unchanged.
5. **Summarize** in the chat before any commit question: the report paths, entry and requirement coverage per scope, orphan and invalid runbook counts, and the top suggestions.
6. **Commit** by the `coverage` policy. Ask an `ask` question only after the summary from item 5 is on screen; the question names the files and the message and does not repeat the summary.
7. **Close.** Give the commit outcome: the short sha, or the paths left uncommitted. Offer `/runbook:create` for the first suggestion.

Done when every scope has its report file, the chat summary lists the same numbers, and the user has seen it before any commit question.
