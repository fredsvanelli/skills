---
description: Runbook coverage report, overall or per capability, feature, slice or path
argument-hint: "[--capability x | --feature y | --slice name | --path glob | --role r] [--all-slices] [--model <model>]"
disable-model-invocation: true
---

# Runbook coverage

Before following this procedure, read [runtime setup](../skills/runbooks/references/runtime.md). Resolve the plugin root from this file's real location and use the active host's tools and argument handling. Do this also when this entry is invoked directly.

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
| `--model m` | force the model of the sub-agent this command launches: `inline` (the main session runs it), `haiku`, `sonnet`, `opus` or `fable` on Claude; `inherit` or an available model ID on Codex |

`--role r` writes the report `_coverage/role-<r>.md` and limits its by-role section to that role. It leaves the entry and requirement numbers as they are. Slice and path filters reach entries only; requirements have no file to slice by.

Examples: `/runbooks:coverage`, `/runbooks:coverage --capability billing`, `/runbooks:coverage --all-slices`.

This file only dispatches. The procedure is in `${RUNBOOKS_PLUGIN_ROOT}/skills/runbooks/instructions/coverage.md`. Dispatching follows `${RUNBOOKS_PLUGIN_ROOT}/skills/runbooks/references/agents.md`: read it before step 1. It covers the model, the brief, the report, questions, calls, commits and a model that cannot launch.

## Dispatch

1. Follow "Dispatch steps" in `${RUNBOOKS_PLUGIN_ROOT}/skills/runbooks/references/agents.md` with the command `coverage` and the instructions file `${RUNBOOKS_PLUGIN_ROOT}/skills/runbooks/instructions/coverage.md`. The brief carries the filter as typed. The command asks nothing before the work.
2. Print the `summary:` of the report as written. It holds the report paths and the numbers of the chat summary.
3. **Close.** Offer `/runbooks:create` for the first suggestion of the summary. Nothing is committed: `_coverage/` is ignored by Git, so it stays local. End with a line that offers `/runbooks:ui` to see the coverage and the runs. For a filtered scope, give the page address that shows the same numbers: `#/coverage?path=<glob>`, `#/coverage?feature=<y>` or `#/coverage?capability=<x>`, the value URL-encoded, and `#/coverage/<name>` for a slice. With `--role`, give `#/coverage?role=<name>`.

Done when the summary is on screen and the close is given.
