# generate-pr-description screenshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `utils:generate-pr-description` captures the screenshots its markers describe and links them from an orphan `pr-assets` branch, falling back to `[SCREENSHOT HERE: …]`.

**Architecture:** Instructions only, in `utils/skills/generate-pr-description/SKILL.md`. One fenced `bash` block holds the publish plumbing; a `node:test` file extracts that block and runs it against a throwaway repo with a local bare remote, so the snippet the agent copies is the one tested.

**Tech Stack:** Markdown skill, git plumbing, Node 18+ `node:test` (no dependencies).

**Spec:** `docs/superpowers/specs/2026-11-20-pr-screenshots-design.md` (ADR: `docs/adr/0001-pr-screenshots-on-orphan-branch.md`)

## Global Constraints

- No new dependency, no capture script, no publish helper file (the test file is the only new file).
- Branch name `pr-assets`; file path inside it `<branch-slug>/<n>-<slug-of-X>.png`.
- Link: `![X](https://github.com/<owner>/<repo>/blob/<sha>/<path>?raw=true)`.
- Plumbing never touches the user's working tree or index (temporary `GIT_INDEX_FILE`).
- Only `localhost`/`127.0.0.1`; viewport 1280x800, plus 390 wide only for responsive CSS/breakpoint diffs.
- Never push without confirmation; the question states `gh repo view --json visibility`.
- utils version 0.7.0.

## Review Focus

1. Second run on the same branch slug, same file names: new commit on top of the old tip, old SHA still reachable, new file content at the path (Task 1 test `second run stacks on the tip`).
2. Remote `pr-assets` moved since the last fetch (another PR pushed): snippet fetches before building, so it builds on the remote tip (Task 1 test `builds on the remote tip, not a stale local ref`).
3. User has staged changes when the skill runs: index and working tree identical before and after (Task 1 test `leaves index and working tree untouched`).
4. Screen shows a token or real personal data: marker kept, no capture (Task 2 prose; checked in C Check).
5. User declines the push: marker kept with the local path after it (Task 2 prose; checked in C Check).

---

### Task 1: Publish snippet and its test

**Files:**
- Modify: `utils/skills/generate-pr-description/SKILL.md` (new `## Step 3: Screenshots` with a `### Publish` subsection; current Step 3 becomes Step 4)
- Test: `utils/skills/generate-pr-description/publish.test.mjs`

**Interfaces:**
- Produces: the first ` ```bash ` block after the line `### Publish` in SKILL.md. Inputs as shell variables set before it: `SHOTS` (dir of `.png` files), `SLUG` (branch slug). Prints exactly one line: the new commit SHA. Exit non-zero on push failure after one retry.

- [ ] **Step 1: Write the failing test** `publish.test.mjs`, using `node:test`, `node:assert/strict`, `child_process.execFileSync`, `fs.mkdtempSync(os.tmpdir())`. Helper `publish(work, shots, slug)` reads SKILL.md, takes the block after `### Publish`, runs it with `bash -c` in `work` with env `SHOTS`, `SLUG`, returns trimmed stdout. Fixture: bare repo `remote.git`, clone `work` with one commit on `main`, `shots/1-form-error.png` (any bytes).
  - `first run creates an orphan pr-assets`: `git rev-list --count <sha>` = `1`; `git ls-remote origin pr-assets` names `<sha>`; `git show <sha>:feat-x/1-form-error.png` equals the file bytes.
  - `second run stacks on the tip`: rewrite the png, publish again → `git rev-parse <sha2>^` = `<sha1>`; `git cat-file -t <sha1>` = `commit`; path holds the new bytes.
  - `builds on the remote tip, not a stale local ref`: a second clone publishes slug `feat-y`; then `work` publishes `feat-x` → the tree of the result has both `feat-x/` and `feat-y/`.
  - `leaves index and working tree untouched`: stage a change in `work` before publishing; `git status --porcelain` and `git diff --cached` are byte-identical before and after.

- [ ] **Step 2: Run it to verify it fails**
  Run: `node --test utils/skills/generate-pr-description/publish.test.mjs`
  Expected: FAIL, no `### Publish` block found.

- [ ] **Step 3: Write the block in SKILL.md.** Approach: `git fetch origin pr-assets` (ignore failure → no parent); `export GIT_INDEX_FILE=$(mktemp)`; `git read-tree <parent>` or `git read-tree --empty`; per file `git update-index --add --cacheinfo 100644,$(git hash-object -w f),$SLUG/$(basename f)`; `git write-tree`; `git commit-tree <tree> [-p <parent>] -m "assets: $SLUG"`; `git push origin <sha>:refs/heads/pr-assets`; on rejection redo once from the fetch; `rm` the temp index; `echo <sha>`.

- [ ] **Step 4: Run it to verify it passes**
  Run: `node --test utils/skills/generate-pr-description/publish.test.mjs`
  Expected: 4 pass, 0 fail.

- [ ] **Step 5: Commit** `feat(utils): publish screenshots to pr-assets by plumbing`.

### Task 2: Capture instructions

**Files:**
- Modify: `utils/skills/generate-pr-description/SKILL.md` (frontmatter `description`, intro, `## Step 3: Screenshots` before `### Publish`, `## Rules`, `## Step 4: Apply`)

**Interfaces:**
- Consumes: the `### Publish` block from Task 1 (prints the SHA).

- [ ] **Step 1: Write Step 3's capture part** (design items 1, 2, 2a, 5, 6): when to try; tool-agnostic (claude-in-chrome, Playwright MCP, Orca, the Codex browser tool); full page vs element; 1280x800 and the 390 rule; may fill and submit forms, only on `localhost`/`127.0.0.1`; login only via existing session or a documented dev user, never `.env`; no capture of secrets or real personal data; files to the scratchpad as `<n>-<slug-of-X>.png`; `SLUG` = branch name with `/` → `-`; owner/repo from `gh repo view --json nameWithOwner,visibility`, failure → markers; confirmation before Publish states the visibility, joined with Step 4's confirmation under `--apply`; on a no, marker plus local path; the link format; every fallback keeps the exact current marker.

- [ ] **Step 2: Update `description`, intro and Rules**: "takes the screenshots itself when it can, else `[SCREENSHOT HERE]` markers"; the existing marker rule applies to the image alt text too (every image says what it proves).

- [ ] **Step 3: Verify**
  Run: `node --test utils/skills/generate-pr-description/publish.test.mjs && grep -n "^## Step\|^### Publish" utils/skills/generate-pr-description/SKILL.md`
  Expected: tests pass; headings Step 1, 2, 3, `### Publish`, 4 in that order.

- [ ] **Step 4: Commit** `feat(utils): generate-pr-description takes its own screenshots`.

### Task 3: cleanup-branches, docs, version

**Files:**
- Modify: `utils/skills/cleanup-branches/SKILL.md:68-71` (add `- \`pr-assets\` (screenshots linked from PR bodies, see generate-pr-description),`)
- Modify: `utils/README.md:9`, `utils/CHANGELOG.md` (new `## 0.7.0 — 2026-11-20`, Added + Changed), `utils/.claude-plugin/plugin.json`, `utils/.codex-plugin/plugin.json` (`0.7.0`)

- [ ] **Step 1: Edit the five files.**
- [ ] **Step 2: Verify**
  Run: `grep -rn '"version"' utils/.claude-plugin utils/.codex-plugin && grep -n "pr-assets" utils/skills/cleanup-branches/SKILL.md utils/CHANGELOG.md`
  Expected: both `0.7.0`; `pr-assets` in both files.
- [ ] **Step 3: Commit** `chore(utils): protect pr-assets; release 0.7.0`.
