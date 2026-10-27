# Runbook coverage: instructions

You write the coverage report the arguments of your brief ask for. The parameters are in `${CLAUDE_PLUGIN_ROOT}/commands/coverage.md`.

You cannot ask the user. Where this file says to ask (`AskUserQuestion`, "ask the user", a diff approval), stop with `status: question` as `agents.md` says. Where it says to say something and stop, put the message in `summary:` and report `status: done`. Commit nothing: the main session commits after it prints your summary.

Read first: `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/coverage.md`. With role tracking on (`roles.enabled` in the config), its "By role" part applies too.

1. **Scopes.** No filter: `overall`. One filter: that scope (`--role r` is the scope `role-r`). `--all-slices`: `overall` plus one `--slice <name>` per key of the config `slices`.
2. **Numbers.** For each scope, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" coverage <filter>` (Markdown) and `... coverage <filter> --json`. Exit code 2 stops the command; show the message.
3. **Suggestions.** From the JSON's uncovered entries and requirements, rank at most five runbooks to write first by the rules in `coverage.md`.
4. **Write** each report from `${CLAUDE_PLUGIN_ROOT}/templates/coverage-report.md` (with role tracking on, its Roles section holds the by-role part of the script output, keys no runbook covers first) to `<paths.runbooks>/_coverage/<scope file name>`, with the script output pasted unchanged.
5. **Report.** Your report follows "The report" in `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/agents.md`. List in `files:` every report you wrote. Put in `summary:` the chat summary: the report paths, entry and requirement coverage per scope, orphan and invalid runbook counts, and the top suggestions. With role tracking on, add the covered, pending and uncovered role and key pairs, and name the first uncovered ones. When the script warns about an `entries` source outside the project, say that those entries belong to another repository and that `/runbooks:settings sources` moves them to `calls` (`${CLAUDE_PLUGIN_ROOT}/docs/adr/0005-upstream-api-in-another-repo-is-a-contract.md`).

Done when every scope has its report file and `summary:` lists the same numbers.
