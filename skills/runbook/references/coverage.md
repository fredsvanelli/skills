# Coverage

Two metrics, computed by `runbook.mjs coverage`:

- **Entry points:** UI routes and API endpoints from the config `entries` sources.
- **Requirements:** ids from the config `requirements` sources. Without a source, the report says "no requirement source configured".

An item is **covered** when an `active` runbook lists its id in `covers`, **pending** when only `draft` runbooks do, and **uncovered** otherwise. `deprecated` and invalid runbooks never count. Ids match exactly: `/deliveries/[deliveryId]` does not cover `/deliveries/[id]`, and the report lists such references under Orphans.

## Filters

| Filter | Keeps |
|---|---|
| `--capability x` or `--slice x` | entries whose file is in the slice `x` of the config `slices` |
| `--feature y` | entries and requirements cited by runbooks with `feature: y` |
| `--path <glob>` | entries whose file matches the glob |

Slice and path filters apply to entries only; requirements have no file to slice by.

## Report

`_coverage/overall.md` without a filter; `_coverage/<scope>.md` with one, where scope is `capability-x`, `feature-y`, `slice-x`, or `path-` plus the glob with every character outside `[a-z0-9]` turned into `-`. Each report is overwritten, so a pull request diff shows the change.

The report has two parts, kept apart:

1. **Script numbers**, the script's Markdown output pasted unchanged: totals, the table by slice, uncovered entries and requirements, orphans, invalid runbooks, warnings.
2. **Agent suggestions**, at most five runbooks to write first. Rank uncovered items by:
   - risk of the flow: money, permissions, deleting data, external integrations first;
   - churn: `git log --since=90.days --format= --name-only -- <file> | wc -l` for each entry file;
   - grouping: entries one runbook can cover together.
   Each suggestion names a runbook id, the ids it would cover, and the reason it comes first.
