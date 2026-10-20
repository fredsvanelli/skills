# Coverage

Two metrics, computed by `runbooks.mjs coverage`:

- **Entry points:** UI routes and API endpoints from the config `entries` sources.
- **Requirements:** ids from the config `requirements` sources. Without a source, the report says "no requirement source configured".

An item is **covered** when an `active` runbook lists its id in `covers`, **pending** when only `draft` runbooks do, **planned** when only placeholders do, and **uncovered** otherwise. `deprecated` and invalid runbooks never count. Ids match exactly: `/deliveries/[deliveryId]` does not cover `/deliveries/[id]`, and the report lists such references under Orphans. When a source of a list did not run (a sibling `root` that is not cloned, a failing `command`), the report skips the orphan check for that list and says so, because a missing id could just be unread.

### By surface

When the `stack` is `backend` or `fullstack`, an entry counts only through runbooks of its own surface: an `api-endpoint` through `api` runbooks, any other entry through `ui` runbooks. A `ui` runbook still lists the endpoints its screens call, so `list --affected` finds it when one changes, but that reference does not cover the endpoint. The by-slice table then has one row per slice and surface. A `frontend` stack keeps one row per slice, and its runbooks cover any entry they cite. Why: `${CLAUDE_PLUGIN_ROOT}/docs/adr/0002-endpoint-coverage-by-surface.md`.

A `mocked` `ui` runbook never covers an endpoint, whatever the stack, because fixtures answer its requests and not the API. It covers its `ui-route` entries, and keeps the endpoints in `covers.entries` for `list --affected`. An endpoint that only mocked runbooks cite stays uncovered and shows as "cited, not covered (mocked)" in the Markdown and in `/runbooks:ui`. Why: `${CLAUDE_PLUGIN_ROOT}/docs/adr/0004-mocked-runbooks-never-cover-endpoints.md`.

Requirements count through runbooks of any surface.

## Filters

| Filter | Keeps |
|---|---|
| `--capability x` or `--slice x` | entries whose file is in the slice `x` of the config `slices` |
| `--feature y` | entries and requirements cited by runbooks with `feature: y` |
| `--path <glob>` | entries whose file matches the glob |

Slice and path filters apply to entries only; requirements have no file to slice by.

## Report

`_coverage/overall.md` without a filter; `_coverage/<scope>.md` with one, where scope is `capability-x`, `feature-y`, `slice-x`, or `path-` plus the glob with every character outside `[a-z0-9]` turned into `-`. Each report is overwritten and stays local: `_coverage/` is ignored by Git.

The report has two parts, kept apart:

1. **Script numbers**, the script's Markdown output pasted unchanged: totals, the table by slice, uncovered entries and requirements, orphans, invalid runbooks, warnings.
2. **Agent suggestions**, at most five runbooks to write first. Rank uncovered items by:
   - risk of the flow: money, permissions, deleting data, external integrations first;
   - churn: `git log --since=90.days --format= --name-only -- <file> | wc -l` for each entry file;
   - grouping: entries one runbook can cover together.
   Each suggestion names a runbook id, the ids it would cover, and the reason it comes first.
