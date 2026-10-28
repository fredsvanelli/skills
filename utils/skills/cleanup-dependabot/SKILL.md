---
name: cleanup-dependabot
description: "Use when the user types /utils:cleanup-dependabot or asks to clean up, resolve, rebase or merge this repository's Dependabot PRs (dependency bumps, security updates)."
argument-hint: "[--dry-run] [--only N,N,...]"
allowed-tools:
  - Read
  - Edit
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---

# Clean up the Dependabot queue

Before following this procedure, read [runtime setup](../../references/runtime.md). Resolve the plugin root from this file's real location and use the active host's tools and argument handling. Do this also when this entry is invoked directly.

Empties the Dependabot PR queue **without breaking the project's flow**: everything reaches `main`
through `develop`, nobody merges red CI, and a major only goes in with someone watching.

Reads the real queue (never from memory), resolves conflicts PR by PR, merges what it can and
returns a report of what went in, what was closed and what was left, with the reason for each.

## Usage

```
/utils:cleanup-dependabot                # the whole queue
/utils:cleanup-dependabot --dry-run      # inventory + plan only; no comment, no merge, no close
/utils:cleanup-dependabot --only 215,180 # only these PRs (the others are not touched)
```

Any other argument is invalid — say so and stop.

**Where it works:** the repository root, with `gh` authenticated (`gh auth status`) and `python3`.
The checks that count as green CI come from `DEPENDABOT_REQUIRED_CHECKS` (comma-separated names), exported in the helper's shell environment (or set in `.claude/settings.json`'s `env` on Claude); without it the helper exits 2. The helper is `${UTILS_PLUGIN_ROOT}/skills/cleanup-dependabot/scripts/dependabot.py` (no `jq` — there is no
`jq` on this machine). Run `python3 <helper>` with no arguments to see the subcommands.

## What this skill does and does not do

| Does | Does not |
|---|---|
| Lists and classifies the open Dependabot PRs (target, semver level, group, CI) | Merge into `main` — **never**, not even with green CI |
| Asks `@dependabot rebase` and, if that does not work, redoes the bump on its own branch | Edit `yarn.lock` by hand |
| Merges into `develop` with `--merge` when CI is green and the PR is `mergeable` | Merge with a missing, skipped or red check; `--admin`; force-push |
| For a PR against `main`: covers it through `develop` and closes it with a comment | Close a `main` PR before the version is in `develop` |
| Major: summarizes the breaking changes and **asks** before merging | Merge a major without an explicit "yes" for that PR |
| Leaves the local `develop` in sync and delivers the report | Auto stash, `git reset`, switch branches with a dirty tree |

---

## Step 1 — Preconditions

From the repo root:

```bash
gh auth status                                  # failed? stop
git status --porcelain --untracked-files=no     # tracked changes? stop and hand back — no stash
git fetch origin
D="${UTILS_PLUGIN_ROOT}/skills/cleanup-dependabot/scripts/dependabot.py"
```

An untracked file does not block (just warn); with `--dry-run` the tree does not even need to be clean,
because nothing switches branches.

Check that `.github/dependabot.yml` still has `target-branch: develop` in every
configured ecosystem. If someone changed that, the reasoning "a PR against `main` is leftover" no
longer holds — say so and ask before going on.

## Step 2 — Inventory

```bash
python3 "$D" list          # table in working order
python3 "$D" list --json   # when you need the fields (updates, ci_problems…)
```

Show the table to the user and, in one line per PR, what you plan to do with it — use the
report's vocabulary (step 6): **merge**, **ask** (major), **rebase**,
**re-extract**, **wait**, **close**, **skip**. With `--dry-run`, **stop here**.

The order the helper returns is the working order, and it is not cosmetic:

1. **`develop` target before `main`** — the `main` ones are only settled after `develop`
   received the bumps, because their rule is "is it already covered in `develop`?".
2. **Group before single** — the `minor-and-patch` group usually covers several singles;
   merging it first closes the others for free. Merging a single that is in the group
   makes Dependabot **recreate the group** without it — rework.
3. **No major before major** — what needs no question goes in first.

With `--only`, keep the same order within the subset. PRs the skill itself creates
by re-extraction (step 5) from a listed PR are in scope — they are the same PR in
other clothes.

## Step 3 — Loop over the PRs against `develop`

For each PR, in this order, **one at a time** — each merge can turn the next ones
`CONFLICTING` (they all touch `yarn.lock`), and the next one's `wait` is what absorbs that.

### 3.1 · State

```bash
python3 "$D" wait N        # waits for mergeable ≠ UNKNOWN and the checks to finish; exit 0 = can merge
```

`UNKNOWN` is GitHub still computing; the helper waits. Conclude nothing from
`UNKNOWN`.

### 3.2 · Conflict → rebase → re-extraction

`mergeable=CONFLICTING`:

```bash
python3 "$D" rebase N      # comments "@dependabot rebase", waits for the head to change, then wait
```

If Dependabot does not answer in time (it gives up when the conflict is not only `yarn.lock`,
or when the branch already got a human push), go to **re-extraction** (step 5) and, at
the end, close the original PR.

**Never resolve `yarn.lock` by hand** and **never push to Dependabot's branch**: from
the first human push on it stops maintaining it, and a hand-edited lockfile is the
fastest way to break `--frozen-lockfile` in CI.

### 3.3 · Red CI

Do not merge. Find the job:

```bash
gh pr checks N
gh run view <run-id> --log-failed | tail -60
```

- A failure the bump explains (new type, removed API, peer dep) → **skip**, report it with the
  log excerpt. That bump needs code, and code is a ticket — suggest
  `/linear-create-ticket`.
- A failure unrelated to the bump (network, runner, known flaky test) → `gh run rerun <run-id> --failed`
  **once**, `wait` again. Red twice = skip and report; do not insist.
- **A skipped job is not green.** The helper requires each check in `DEPENDABOT_REQUIRED_CHECKS` to be
  `SUCCESS`; `missing`/`SKIPPED` counts as not green. If the project paused CI (for example
  `.github/ci-pause.json`), the jobs do not even run and the PR looks clean. `rerun --failed` does not
  rerun a skipped job: **skip** the PR, with the reason "CI paused until <date>", and do not wait for the
  pause to end within this run.

### 3.4 · Major → ask

Applies to a single major and to a group that contains a major (the helper marks it `⚠`).
Before merging, read the PR body and extract, in up to 6 lines: what breaks, whether the
project uses the affected API (check the code with `grep`), and the required Node/React version.

```bash
gh pr view N --json body --jq .body | grep -n -iE 'breaking|deprecat|drop|requires? node' | head
```

Then ask with `AskUserQuestion`: merge / skip / re-extract as its own PR to
take a closer look. **No "yes", no merge.** A "yes" applies to that PR; the next major
asks again.

### 3.5 · Merge

Only when `wait` exited 0 (and the major was approved):

```bash
gh pr merge N --merge    # --merge, like the rest of the repo; never --admin, never squash
python3 "$D" wait N        # confirms MERGED
git pull --ff-only origin develop
```

If `--ff-only` fails, the local `develop` diverged — stop and ask; do not force.

## Step 4 — PRs against `main`

Dependabot opens security updates against the default branch (`main`) even with
`target-branch: develop`. They are **not merged**: `main` only receives `develop` at
release. So `mergeable`, `CONFLICTING` and the CI of these PRs are **irrelevant** —
do not ask for a `rebase` on them; the only question is whether `develop` has the version. For each one, and
for each package in it (a group has several):

```bash
python3 "$D" covered <pkg> <target-version>         # checks yarn.lock (npm) or uses: (actions) on origin/develop
```

| `covered` | Action |
|---|---|
| **covered** | Close with a comment (below). Nothing to do in `develop`. |
| **not used** (the package is no longer in `develop`) | Confirm it was removed (`git log -S'"<pkg>"' --oneline -1 origin/develop -- package.json yarn.lock`) and close it as **obsolete**, citing the commit. A wrong name in `covered` also gives "not used" — check before. |
| **NOT covered**, but an open PR against `develop` brings the version | Wait for step 3 to finish; run `covered` again. |
| **NOT covered** for good | **Re-extract** (step 5) against `develop`, merge, and only then close the `main` one. |

Closing comment — Markdown, short, with the link to what covers it:

```bash
gh pr comment N --body "Covered in \`develop\` by #215 (\`js-yaml\` resolved to 4.3.2). It reaches \`main\` in the next \`develop → main\` release; bump PRs do not go into \`main\` directly in this repo (see \`.github/dependabot.yml\`)."
gh pr close N
```

The Dependabot alert on `main` **stays open until the release** — that is expected. Say so
in the report, so nobody reopens the PR thinking the alert was forgotten.

## Step 5 — Re-extraction (bump redone on its own branch)

When Dependabot's rebase did not solve it, or the PR targets `main` and `develop` does not have the
version. One branch per original PR:

```bash
git checkout -b chore/deps-<pkg-slug>-<version> origin/develop
```

- **Direct dependency** (in `package.json`): edit the range in `package.json` to the
  target version (the `Edit` tool) and run `yarn install` — `yarn.lock` comes from yarn, never
  from you.
- **Transitive** (only in `yarn.lock`): `yarn upgrade <pkg>` — without `@version`, otherwise classic
  yarn promotes it to a direct dependency.
- **GitHub Action**: edit `uses: <action>@vN` in `.github/workflows/*.yml`.

Check with `python3 "$D" covered <pkg> <version> HEAD`. Then:

```bash
yarn lint && <project type-check>   # the command is in AGENTS.md / CLAUDE.md / package.json
git add package.json yarn.lock .github/workflows
git commit -m "chore(deps): bump <pkg> from <from> to <to> (re-extracted from #N)"
git push -u origin chore/deps-<pkg-slug>-<version>
gh pr create --base develop --title "chore(deps): bump <pkg> from <from> to <to>" --body "Re-extracted from #N, which targets \`main\`. Closes #N when merged."
```

The new PR then follows step 3 (it is a PR against `develop` like any other — including
the major question). Once merged, close the original with a comment pointing to the new one.

If `yarn upgrade` does not reach the target version (the parent's range does not allow it), this is not
a dependency bump, it is a change in the parent — stop, report, suggest a ticket.

## Step 6 — Report

One table, one row per original PR:

| PR | Package(s) | Result |
|---|---|---|
| #215 | group minor-and-patch (7) | **merged** into `develop` (`<sha>`) |
| #180 | actions/upload-artifact 4→7 | **merged** after confirmation (major) |
| #204 | js-yaml 4.3.2 | **closed** — covered by #215 |
| #176 | @fullcalendar/react 6.1.21 | **re-extracted** into #2xx → merged; original closed |
| #177 | react-apexcharts 2.1.1 | **closed** — `develop` already had 2.1.1 |
| #1xx | … | **skipped** — red CI: `<job>`, `<reason in one line>` |

Below the table: the note about the alert on `main` (step 4), the final state of the local `develop`
(`git log --oneline -1`), and what was left pending with the next step for each.

---

## Pitfalls

**`mergeable` takes a while to update after each merge.** GitHub recomputes the other
PRs in the background; `UNKNOWN` for a minute is normal. The helper waits — do not decide by hand.

**Merging a group member separately recreates the group.** Dependabot closes the group
and opens another without that package. That is why the group goes first.

**`gh pr checks` lists an old check on a `main` PR.** Their CI ran against the tree
from months ago; "green" there says nothing about `develop`. It is irrelevant — they are not
merged anyway.

**"Green" is only what `DEPENDABOT_REQUIRED_CHECKS` covers.** An e2e suite that only runs on PRs
to `main` does not run here. That is the project's agreement, not a gap of yours, but do not sell it as
"e2e passed".

**A framework/ORM bump in the group.** A framework minor sometimes changes build or query
behavior; if CI passes but the user wants to see it running, `/run` exists. Do not invent
manual verification nobody asked for.

**Closing a security update PR without covering it.** The alert leaves the PR list, not the
security panel — and nobody goes back to look. Only close with `covered` = covered, or
with the package proven removed from the project.

## Done when

- The inventory was read from `gh`, shown to the user, and every PR has a result in the report.
- No PR was merged into `main`; none was merged with a missing, skipped or red check.
- No major went in without an explicit "merge" answer for that PR.
- Every closed `main` PR has a comment pointing to what covers it in `develop` — or the
  commit that removed the package.
- Every skipped PR has its reason and the next step (rerun, ticket, user decision).
- The local `develop` is at `origin/develop` (clean `--ff-only`) and the tree is clean.
