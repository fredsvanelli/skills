# Coverage

Two metrics, computed by `runbooks.mjs coverage`:

- **Entry points:** UI routes and API endpoints from the config `entries` sources.
- **Requirements:** ids from the config `requirements` sources. Without a source, the report says "no requirement source configured".

An item is **covered** when an `active` runbook lists its id in `covers`, **pending** when only `draft` runbooks do, **planned** when only placeholders do, and **uncovered** otherwise. `deprecated` and invalid runbooks never count. Ids match exactly: `/deliveries/[deliveryId]` does not cover `/deliveries/[id]`, and the report lists such references under Orphans. When a source of a list did not run (a `root` that does not exist, a failing `command`), the report skips the orphan check for that list and says so, because a missing id could just be unread.

### By surface

When the `stack` is `backend` or `fullstack`, an entry counts only through runbooks of its own surface: an `api-endpoint` through `api` runbooks, any other entry through `ui` runbooks. A `ui` runbook still lists the endpoints its screens call, so `list --affected` finds it when one changes, but that reference does not cover the endpoint. The by-slice table then has one row per slice and surface. A `frontend` stack keeps one row per slice, and its runbooks cover any entry they cite. Why: `${RUNBOOKS_PLUGIN_ROOT}/docs/adr/0002-endpoint-coverage-by-surface.md`.

A `mocked` `ui` runbook never covers an endpoint, whatever the stack, because fixtures answer its requests and not the API. It covers its `ui-route` entries, and keeps the endpoints in `covers.entries` for `list --affected`. An endpoint that only mocked runbooks cite stays uncovered and shows as "cited, not covered (mocked)" in the Markdown and in `/runbooks:ui`. Why: `${RUNBOOKS_PLUGIN_ROOT}/docs/adr/0004-mocked-runbooks-never-cover-endpoints.md`.

A `ui` runbook's `calls` never count. They name operations of an upstream API in another repository, whose own install covers its endpoints, so they are not entries here and never make an orphan. Why: `${RUNBOOKS_PLUGIN_ROOT}/docs/adr/0005-upstream-api-in-another-repo-is-a-contract.md`.

Requirements count through runbooks of any surface.

### By role

With role tracking on, `runbooks.mjs coverage` adds a by-role section, and `--role <name>` limits it to one role (`config.md`, Roles). It counts matrix keys of `roles.json`, not actions: a key is `<capability>/<feature>` or `<capability>/*`, and the unit is a role and key pair.

The keys are the union of the effective keys of every role. For a role and a key:

- The role **has access** when its effective actions for the key, by the lookup rule of `config.md`, are not empty.
- A runbook **qualifies** when it has no problems, its status is `active` or `draft`, its `roles` include the role, and its `capability/feature` matches the key (`capability/*` matches every feature of that capability).
- When the role has access, any qualifying runbook counts.
- When the role has no access, a runbook counts only if it has a `denied`, `hidden` or `read-only` line for that role. A denial that no step proves leaves the key uncovered.
- The pair is **covered** when a qualifying runbook is `active`, **pending** when only `draft` runbooks qualify, and **uncovered** otherwise.

On a key of a context (`config.md`, "Contexts"), the unit is a role, a key and a case, with one row per case of the context. Keys of no context keep the role and key pair. For a role, a key and a case:

- The role has access when its effective actions in that case are not empty.
- A runbook qualifies by the rule above, and its `cases` must include the case.
- With no access, a runbook counts only if it has a `denied`, `hidden` or `read-only` line for that role that applies in that case: a line that names the case, or a line with no case on a step that runs in it.

The by-role table gets a Case column when any row has a case, and `--role <name>` shows the cases under each key of a context.

A runbook in review still counts, so turning tracking on does not drop coverage to zero. Placeholders and `deprecated` runbooks never count.

## Filters

| Filter | Keeps |
|---|---|
| `--capability x` or `--slice x` | entries whose file is in the slice `x` of the config `slices` |
| `--feature y` | entries and requirements cited by runbooks with `feature: y` |
| `--path <glob>` | entries whose file matches the glob |

Slice and path filters apply to entries only; requirements have no file to slice by.

## Report

`_coverage/overall.md` without a filter; `_coverage/<scope>.md` with one, where scope is `capability-x`, `feature-y`, `slice-x`, `role-r` (role tracking on, `--role r`), or `path-` plus the glob with every character outside `[a-z0-9]` turned into `-`. Each report is overwritten and stays local: `_coverage/` is ignored by Git.

The report has two parts, kept apart:

1. **Script numbers**, the script's Markdown output pasted unchanged: totals, the table by slice, uncovered entries and requirements, orphans, invalid runbooks, warnings.
2. **Agent suggestions**, at most five runbooks to write first. Rank uncovered items by:
   - risk of the flow: money, permissions, deleting data, external integrations first;
   - churn: `git log --since=90.days --format= --name-only -- <file> | wc -l` for each entry file;
   - grouping: entries one runbook can cover together.
   Each suggestion names a runbook id, the ids it would cover, and the reason it comes first.
