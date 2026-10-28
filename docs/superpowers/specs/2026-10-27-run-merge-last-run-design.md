# A partial run that merges into last_run

Design of 2026-10-27, written before any code. Marks: **(user)** is what the user decided, **(call)** is the designer's call that the user has not reviewed one by one. The user approved the list of defaults in "Decided with the user" as a whole.

## Why

The user ran `billing.issue-invoice` in full. S02 failed, S01 and S03 passed. They fixed the bug and ran `/runbooks:run billing.issue-invoice --steps S02`, which passed. `last_run` still said `failed`, because a run with `--steps`, `--role` or `--case` leaves `last_run` and `status` unchanged (`runbooks/skills/runbooks/instructions/run.md`, step 5, item 3). The only way to clear the failure was another full run. **(user)**

The same happened with roles: 8 of 9 roles passed and role 9 had a small bug. A full run of 9 roles to prove one fix was not worth the time. **(user)**

Today `last_run` holds one `date`, `commit`, `result` and `report` for the whole runbook. The run already records a state per step, role, case and viewport, but only in the report under `_runs/`, which Git ignores.

## Goals

- `last_run` keeps a result per cell. A cell is one step, with one role (role tracking on), one case (a runbook with cases) and one viewport (a runbook with `viewports`). These are the dimensions the run already records states on (`references/run-modes.md`, "Roles", "States"). **(user: per step and per role; case and viewport follow the same rule, approved as a default)**
- Each cell keeps its own `date`, `commit` and `report`, so the reader sees which run proved it. **(user)**
- A new `run` flag, `--merge`, makes a partial run write its cells into `last_run` and keep every other cell as it was. **(user asked for the flag; the name `--merge` was proposed and approved)**
- The overall `last_run.result` comes from all cells together. **(user)**
- `last_run` says when its cells come from more than one run. **(user)**
- `--merge` recomputes `status` from all cells together, the way a full run computes it today. **(approved default)**

## Non-goals

- Merging without the flag. A partial run without `--merge` behaves exactly as today: `status`, `last_run` and `review` stay unchanged. **(approved default)**
- Rebuilding cells from old reports. Reports are not committed, so another clone has none. **(approved default)**
- Clearing `review`. Only `update` clears it, as today. **(approved default)**
- Merging across runbooks. Each runbook's `last_run` is merged on its own.

## Anti-goals

- A forced partial run must never overwrite a cell it did not run. In the user's example, `--steps S02 --merge` must leave S01 and S03 exactly as they were. **(user)**
- A merged `last_run` must not look like one clean full run when it is not. The mixed-runs warning and the per-cell origin exist for this. **(user)**
- An old `last_run` (the current one-line shape) must keep working for every reader until the runbook runs again.

## Behavior

### Full run

Without `--steps`, `--role` or `--case`, `run` replaces `last_run` as today, now with every cell of the run filled from this run's report. `outdated` goes away on every cell. **(approved default)**

### Partial run with --merge

1. `run` computes the cells this run covered, from the report.
2. Each covered cell is replaced by this run's state, `date`, `commit` and `report`, and loses `outdated`.
3. Every other cell stays as it was, `outdated` included. **(user)**
4. A cell the runbook has (from `passes <id>`) but `last_run` does not hold is **pending**. This covers a runbook whose `last_run` is still in the old shape, a step added later, a new role, a new case or a new viewport. **(approved default)**
5. The overall fields are recomputed (below), and `status` is recomputed from the states of all cells.

`--merge` without `--steps`, `--role` or `--case` is the same as a full run, and `run` says so once. **(call)**

A `no-account` row did not run the step, and `mcp.secretsFile` differs from one machine to the next. In a `--merge` run, a `no-account` row does not replace an existing cell. It fills only a pending cell. A `blocked` row, a case whose data could not be built included, did run and replaces the cell. **(call, from the anti-goal "never overwrite a cell it did not run")**

### Status

`format.md` defines `active` as a runbook whose full run passed. A `--merge` run moves `draft` to `active` only when the merged cells amount to that: no cell pending, no cell `outdated`, and the states pass today's `nextStatus` rule. So in the user's example (full run, `update`, then `--steps S02 --merge`) a `draft` runbook stays `draft` while S01 and S03 carry `outdated`. `nextStatus` (`scripts/lib/status.mjs`) throws on a state it does not know, so the script handles pending and `outdated` before it calls `nextStatus`. `result` ignores `outdated`, as today. **(call)**

### Old-format last_run

A `last_run` in the current shape has no cells. The first `--merge` run creates the cells it ran and leaves the rest pending, so the result cannot be `passed` until a full run or further merges fill every cell. **(approved default)**

### Overall fields

- `result`: `failed` when any cell failed; else `blocked` when any cell is `blocked` or `blocked-by-parent`; else `incomplete` when any cell is pending; else `passed`. `not-applicable`, `no-account` and `waived` count as they count today for the report's `result`. `incomplete` is a new value. **(call: the user said a pending cell keeps the result from being `passed`; the name and its place in the order are a call)**
- `mixed: true` when the cells come from more than one report. It goes away when one full run rewrites every cell. **(user asked for the warning; the key name is a call)**
- `date`, `commit` and `report` name the newest run that wrote a cell, so readers that show "last run" (`check`, `explore`) keep showing something true. **(call)**
- `oldest` holds the `date` of the oldest cell. `stale` (`scripts/lib/stale.mjs`) uses it instead of `date`, so a merge on one step does not make a runbook whose other steps ran months ago look fresh. **(call)**
- `outdated: true` while any cell has `outdated`. It goes away only when no cell has it. **(user)**

### outdated

When `update` or `audit --fix` changes a runbook in a way that marks `last_run.outdated` today, every existing cell gets `outdated: true`, and so does the overall field. A later `--merge` run clears it on the cells it ran. The overall `outdated` clears only when every cell has run after the change. **(user)**

In the user's example: full run, then `update` edits S02's Expected (all cells marked), then `--steps S02 --merge`. S02 loses the mark, S01 and S03 keep their `passed` with `outdated: true`, and `last_run.outdated` stays `true`. **(user)**

Marking every cell, not only the cells of the edited step, follows today's rule: the edit marks the whole `last_run`, because a change to one step or a precondition can change what later steps see. **(call)**

### Cells that no longer exist

A cell in `last_run` whose step, role, case or viewport the runbook no longer has (from `passes <id>`) is dropped the next time `last_run` is written, and does not count toward `result`. A case or role rename through `rename-case` or the `roles:*` commands moves the cells to the new name. A delete drops them. **(call)**

## The frontmatter shape

The frontmatter parser (`runbooks/scripts/lib/yaml.mjs`) reads a YAML subset: block maps nested by indentation, flow maps `{ k: v }`, lists of scalars. It has no lists of maps, and its keys match `[A-Za-z0-9_.-]+`, so a case key `*` or a key with spaces does not parse. **(fact)**

The shape is the builder's call within these constraints: **(call)**

- the project's parser reads it, or the parser grows to read it and `references/format.md` documents the change. Older plugin installs do not need to read the new shape, because the user is the only one using the plugin today **(user)**;
- the one-line old shape stays valid;
- each cell shows its state and its origin (`date`, `commit`, `report`) and its `outdated` mark, as the user asked;
- it stays readable at the size of a real runbook. 9 roles, 5 steps and 2 viewports are 90 cells. Grouping cells by the run that wrote them, so each run's `date`, `commit` and `report` appear once and each cell names its run, is one way to keep it short.

A sketch with one run per cell, before any compaction, to show the content:

```yaml
last_run:
  date: 2026-10-18
  oldest: 2026-10-16
  commit: "def5678"
  result: passed
  report: _runs/2026-10-18-0910-billing.issue-invoice.md
  mixed: true
  cells:
    S01: { result: passed, date: 2026-10-16, commit: "abc1234", report: _runs/2026-10-16-1432-billing.issue-invoice.md }
    S02: { result: passed, date: 2026-10-18, commit: "def5678", report: _runs/2026-10-18-0910-billing.issue-invoice.md }
    S03: { result: passed, date: 2026-10-16, commit: "abc1234", report: _runs/2026-10-16-1432-billing.issue-invoice.md }
```

## Who writes last_run

Today the agent writes `last_run` by hand from `run.md` step 5. With cells, a hand merge is easy to get wrong, and the anti-goal forbids touching a cell the run did not cover. A script command writes it instead, for example `runbooks.mjs last-run <id> --report <path> [--merge]`, dry run by default and `--write` to apply, like `mark-review`. It reads the report, merges, recomputes `result`, `mixed`, `oldest`, `outdated` and `status`, and edits only the `last_run` and `status` keys, the way `frontmatter-edit.mjs` keeps every other line byte for byte. **(call)**

`update` and `audit --fix` mark `outdated` through a script command too, for the same reason. **(call)**

## Readers to update

Every reader must accept both shapes. **(approved default)**

| Reader | Today | With cells |
|---|---|---|
| `scripts/lib/runbooks.mjs` (`lastRun`, problems) | checks `outdated` is a boolean | validates cells, states, `mixed`, `incomplete` |
| `scripts/lib/format.mjs` (`lastRunText`, `checkMarkdown`) | one date and result | adds the mixed warning, `incomplete`, and the cells that are failed, blocked, pending or outdated |
| `commands/check.md`, `scripts/lib/reports.mjs` (`latestReport --full`) | "last full run" is the newest non-partial report | the run `last_run` names may be a partial `--merge` run; `check` explains the mix and lists the reports behind it |
| `scripts/lib/explore.mjs` | one report link per runbook | links every report the cells cite |
| `scripts/lib/role-views.mjs` | reads the role's rows in the one `last_run` report | reads each role's cells, or the report each cell cites |
| `scripts/lib/stale.mjs` | `last_run.date` | `last_run.oldest` when set, else `date` |
| `skills/runbooks/instructions/whats-next.md` | `never-run`, `outdated`, `failing` | `incomplete` counts with `failing` as unproven work **(call)** |
| `commands/orchestrator.md` | `git log <last_run.commit>..HEAD` on a regression; runs on `failed`, `blocked` or `outdated` | uses the commit of the failed cell; `incomplete` is also a reason to run. The orchestrator keeps launching full runs and never passes `--merge`, so a leftover `outdated` cell cannot make it loop **(call)** |

## Docs to update

- `commands/run.md`: the `--merge` row in the flag table, and the lines that say partial runs leave `last_run` unchanged.
- `skills/runbooks/instructions/run.md`, step 5: the full-run write, the `--merge` write, and the script command.
- `skills/runbooks/references/format.md`: the `last_run` row, the new shape, `incomplete`, `mixed`, `oldest`, cell `outdated`.
- `skills/runbooks/references/run-modes.md`, "Roles": `--role` and `--case` with `--merge`.
- `skills/runbooks/instructions/update.md`, `audit.md`, `commands/update.md`, `commands/audit.md`, `commands/check.md`: "only a full run clears `outdated`" becomes "a run clears `outdated` on the cells it covers".
- `runbooks/CONTEXT.md`, if its glossary defines `last_run`.
- A new ADR in `runbooks/docs/adr/` records that `last_run` holds cells and a partial run can merge into it, with the options considered: a flag versus always merging (the user chose the flag), and one result versus cells with their origin (the user chose cells).
- Plugin version bump.

## Notes for the builder

- With role tracking off, `passes` exits (it calls `requireTracking`). The set of cells then comes from the steps and `viewports`.
- `merge-roles` folds a role into another. The folded role's cells are dropped.
- `roles:update` renames a role by editing runbooks by hand today, so moving cells on a rename needs a script call there.
- `stale` treats a pending cell as never run.

## Left to the builder

- The compact frontmatter shape, within the constraints above.
- The script command's name and flags.
- How `run` passes the report to the script in each mode, `prompt` imports included.
- Test cases, following the existing `*.test.mjs` files.
