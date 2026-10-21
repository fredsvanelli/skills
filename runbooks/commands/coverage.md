---
description: Runbook coverage report, overall or per capability, feature, slice or path
argument-hint: "[--capability x | --feature y | --slice name | --path glob | --role r] [--all-slices]"
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
| `--path glob` | entries whose file matches the glob (`src/app/**/billing/**`) |
| `--role r` | role tracking on only: the by-role section limited to one role. Writes the report `_coverage/role-r.md`, named by the scope rule of `references/coverage.md` |
| `--all-slices` | on its own: the `overall` report plus one report per slice in the config |

`--role r` writes the report `_coverage/role-<r>.md` and limits its by-role section to that role. It leaves the entry and requirement numbers as they are. Slice and path filters reach entries only; requirements have no file to slice by.

Examples: `/runbooks:coverage`, `/runbooks:coverage --capability billing`, `/runbooks:coverage --all-slices`.

Read first: `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/coverage.md`. With role tracking on (`roles.enabled` in the config), its "By role" part applies too.

1. **Scopes.** No filter: `overall`. One filter: that scope (`--role r` is the scope `role-r`). `--all-slices`: `overall` plus one `--slice <name>` per key of the config `slices`.
2. **Numbers.** For each scope, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" coverage <filter>` (Markdown) and `... coverage <filter> --json`. Exit code 2 stops the command; show the message.
3. **Suggestions.** From the JSON's uncovered entries and requirements, rank at most five runbooks to write first by the rules in `coverage.md`.
4. **Write** each report from `${CLAUDE_PLUGIN_ROOT}/templates/coverage-report.md` (with role tracking on, its Roles section holds the by-role part of the script output, keys no runbook covers first) to `<paths.runbooks>/_coverage/<scope file name>`, with the script output pasted unchanged.
5. **Summarize** in the chat: the report paths, entry and requirement coverage per scope, orphan and invalid runbook counts, and the top suggestions. With role tracking on, add the covered, pending and uncovered role and key pairs, and name the first uncovered ones. When the script warns about an `entries` source outside the project, say that those entries belong to another repository and that `/runbooks:settings sources` moves them to `calls` (`${CLAUDE_PLUGIN_ROOT}/docs/adr/0005-upstream-api-in-another-repo-is-a-contract.md`).
6. **Close.** Offer `/runbooks:create` for the first suggestion. Nothing is committed: `_coverage/` is ignored by Git, so it stays local. End with a line that offers `/runbooks:ui` to see the coverage and the runs. For a filtered scope, give the page address that shows the same numbers: `#/coverage?path=<glob>`, `#/coverage?feature=<y>` or `#/coverage?capability=<x>`, the value URL-encoded, and `#/coverage/<name>` for a slice. With `--role`, give `#/coverage?role=<name>`.

Done when every scope has its report file and the chat summary lists the same numbers.
