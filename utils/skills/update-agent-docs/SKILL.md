---
name: update-agent-docs
description: "Use when the user types /utils:update-agent-docs, or asks whether CLAUDE.md or AGENTS.md (or a nested copy) needs updating after a change, or before opening a PR in a project whose workflow runs it (for example a SPEC-SS Secure step after utils:review-work). --apply writes the proposed edits."
argument-hint: "[--base <branch>] [--apply]"
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
  - Edit
---

# Update agent docs

Before following this procedure, read [runtime setup](../../references/runtime.md). Resolve the plugin root from this file's real location and use the active host's tools and argument handling. Do this also when this entry is invoked directly.

Decides whether the branch's work changes what the agent instruction files (`CLAUDE.md`,
`AGENTS.md`, nested copies) must say. These files load into every session, so every line costs
every future task. **"No update needed" is the usual, correct verdict.** The job is to find the
few edits that are worth it, with evidence, and to keep the file from growing.

Read-only without `--apply`. README, OpenAPI and other docs are out of scope: `utils:review-work`'s
*Documentation* criterion owns them.

## Usage

```
/utils:update-agent-docs
/utils:update-agent-docs --base develop
/utils:update-agent-docs --apply
```

| Flag | Effect |
|---|---|
| `--base <branch>` | Base of the comparison. Default: `git_host.default_branch` in `.pmkit/config.yaml`, else `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`, else `main` |
| `--apply` | Writes the proposed edits to the instruction files. Never commits |

## Step 1: Find the files and check every reference

```bash
REFS="${UTILS_PLUGIN_ROOT}/skills/update-agent-docs/scripts/refs.mjs"
git fetch -q origin "$BASE" 2>/dev/null
B=$(git rev-parse -q --verify "origin/$BASE" >/dev/null && echo "origin/$BASE" || echo "$BASE")
node "$REFS" --base "$B"
```

Use `$B` as the base in every command below.

For each `CLAUDE.md` and `AGENTS.md` in the repo (ignored and vendored paths skipped), `refs.mjs` prints:

- the line count, and which file is the **source**: a symlink names its target, and a file that
  only holds `@AGENTS.md` says *import only*. Propose edits to the source file only.
- the **managed blocks** (`<!-- runbooks:start -->…<!-- runbooks:end -->`,
  `<!-- claude-reflect… -->…<!-- end claude-reflect -->`, any start/end marker pair). Never edit
  inside them. A rule already in a claude-reflect block is already captured: do not add it again.
- every backticked path, script (`yarn x`, `npm run x`…) and code-shaped identifier, checked
  against the merge base and the working tree: `broken-by-branch` (with the rename target or
  the scripts the branch added), `already-broken`, `ok`, and `unchecked` (globs, placeholders,
  plain words). Read the `unchecked` ones yourself only when the diff touches what they name.

## Step 2: Gather what the branch built

```bash
git log --format='%h %s%n%b' $B..HEAD
git diff --name-status -M $B...HEAD
git diff $B...HEAD
```

Read the design docs, plans, ADRs and glossaries the branch added or changed
(`docs/superpowers/specs/`, `docs/superpowers/plans/`, `docs/adr/`, `CONTEXT.md`, `GLOSSARY.md`),
and note new or removed scripts in `package.json` (or the stack's equivalent), env vars, CI
workflows and dependencies. Fix commits, reverts and review comments
(`gh pr view --json reviews,comments` when a PR exists) are the evidence for Step 4.

## Step 3: List the candidates

Three kinds, nothing else:

| Kind | What it is | Source |
|---|---|---|
| **Stale** | A line the branch made wrong: a renamed or deleted path, a renamed script, a removed identifier, a rule the new code contradicts | `broken-by-branch` rows, plus rules the diff contradicts |
| **Missing** | A convention, required wrapper, pattern, command, env var or workflow rule the branch **introduced** that applies beyond this ticket | the diff; every Missing finding cites a `file:line` or commit in it |
| **Misplaced** | Ticket-level detail in the always-loaded file: a rule tagged with a ticket id, a changelog sentence, a version list that duplicates `package.json` | the file itself |

- `already-broken` rows are not the branch's doing. They go in the report's *Already broken*
  line, not in the findings.
- A Missing finding states only what the diff shows. A rule the code will need but the branch
  never uses (a context the caller must set, a lint rule nobody added) is not a finding.
- **The file's own precedent does not make a ticket rule a convention.** A section that lists
  business rules per ticket (`SHOP-301: …`, `SHOP-355: …`) is itself a Misplaced candidate. The
  branch's ticket rule belongs in its spec, never as one more line in that section.

## Step 4: Gate Missing and Misplaced

Stale findings skip the gate: a wrong fact is always worth fixing. Keep a Missing or Misplaced
candidate only when all three answers are **yes**, and write the three answers in the finding:

| Gate | Yes when | No when |
|---|---|---|
| (a) Future tasks | It applies to work beyond this ticket: every new repository, route, migration, command | It describes this ticket's behavior: a threshold, a format, an exception, a field this feature reads |
| (b) Nothing else teaches it | No code, type, lint rule, test or doc the agent reads anyway carries it | A test asserts it, a type or name expresses it, the ticket spec or an ADR holds it and nothing needs a pointer to it |
| (c) Agents get it wrong without it | The branch history shows the mistake: a fix commit, a revert, a review comment. Without that, a concrete reason an agent would do the wrong thing | Only "might help someone" |

A failed (b) is often a better fix somewhere else: a doc comment on the type, a lint rule, a
test. Name it in the report's *Not for the instruction file* line; do not write it into the
instruction file.

A ticket's business rule fails (a), even when its fix commit passes (c): the commit shows the
mistake was made in this ticket, and the spec and tests now hold the rule.

## Step 5: Write the edit

For each finding that survives, write the smallest edit that fixes it:

- **Stale**: replace the wrong fact; delete the line when the thing it described is gone.
- **Missing**: one rule, in the file's existing section for that topic, stating what to do and
  the one-clause reason. No ticket ids, commit hashes or story of how it was found: those are
  history, and the evidence line of the report carries them. When a doc or ADR holds the detail,
  point to it with the condition for reading it: *Read `docs/adr/0007-tenant-scoping.md` before
  changing `src/db/tenantScope.ts`.*
- **Misplaced**: move the text to a doc or ADR (or delete it when the spec already holds it) and
  leave at most a one-line pointer with its reading condition.

Match the file's language, voice and format: a table row where the file uses tables, a bullet
where it uses bullets. Prefer deleting or moving text over adding it.

## Step 6: Report

Write it in the language of the instruction file.

````markdown
Update recommended (2 findings)

### 1. Stale: `yarn db:seed` was renamed
- Evidence: `package.json:3` on the branch (commit `92bf287`), `db:seed` → `db:seed:dev`
- Target: `CLAUDE.md`, Commands

```diff
-- `yarn db:seed` — seeds the local database; run it after every migration
+- `yarn db:seed:dev` — seeds the local database; run it after every migration
```

### 2. Missing: …
- Evidence: …
- Gate: (a) yes, every new repository …; (b) yes, nothing imports-checks it …; (c) yes, fix commit `79ddcad` …
- Target: …

```diff
…
```

Net change: CLAUDE.md +1 −0 lines.
Already broken (before this branch): `docs/architecture.md` (CLAUDE.md:14).
Not for the instruction file: `Cart.subtotal` vs `total` → a doc comment on `Cart`.
````

- The first line is exactly `Update recommended (N findings)` or `No update needed`. With no
  finding, follow it with one sentence on why (what the branch changed and where it is already
  recorded), then the optional lines below.
- Each finding: kind, evidence, gate answers (Missing and Misplaced only), target file and
  section, and the exact edit as a unified diff of the source file.
- Then, only when they apply, one line each: *Net change* (per file), *Already broken*, *Not for
  the instruction file*, and, when the source file is over about 200 lines, *Over 200 lines* with
  its biggest Misplaced candidate, even if the branch did not add it.

## Step 7: Apply (only with `--apply`)

Apply the diffs with `Edit`, never inside a managed block, then show the result:

```bash
git diff -- '*CLAUDE.md' '*AGENTS.md'
```

Do not commit unless the user asks.
