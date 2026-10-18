---
name: generate-pr-description
description: "Write a pull request description from the branch's real diff, for the reviewer: what changes, where to look first, risks, and a 'How to reproduce' with manual steps and [SCREENSHOT HERE] markers. Use when the user types /utils:generate-pr-description or asks to write the PR description, the PR body, or describe this branch for review. --apply writes it to the PR with gh."
argument-hint: "[--base <branch>] [--apply] [--pr <number>]"
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
---

# /utils:generate-pr-description

Reads the branch's real diff and writes the PR description **for the reviewer**, not for the
author. The bar: the reviewer understands what changed, where to look first, and can test it
by hand without asking anything.

## Usage

```
/utils:generate-pr-description
/utils:generate-pr-description --base main
/utils:generate-pr-description --apply
```

| Flag | Effect |
|---|---|
| `--base <branch>` | Base of the comparison. Default: `develop` when `origin/develop` exists, else the default branch (`git symbolic-ref refs/remotes/origin/HEAD`) |
| `--apply` | Writes to the branch's open PR with `gh pr edit --body-file` |
| `--pr <number>` | Target PR for `--apply` when there is more than one |

Without `--apply`, it only prints the Markdown in the chat.

## Step 1: Gather the material

Run all of it before writing a line:

```bash
git merge-base --is-ancestor origin/$BASE HEAD 2>/dev/null || git fetch origin $BASE
git log --oneline origin/$BASE..HEAD
git diff --stat origin/$BASE...HEAD
git diff origin/$BASE...HEAD
```

And the ticket context, when the branch name or the commits cite ticket ids (`ABC-123`, `#123`):

```bash
git log origin/$BASE..HEAD --format=%s%n%b | grep -oE '[A-Z][A-Z0-9]+-[0-9]+' | sort -u
```

**Never write the description from the commit messages alone.** A commit says what the author
thought they did; the diff says what went in. When they disagree, the diff wins and the
mismatch becomes a note under *Watch out for*.

Also read, without asking:

- the language of the last few merged PRs (`gh pr list --state merged --limit 5 --json title,body`), or of the commits when there are none. Write the description in that language, headings included.
- how to start the app: `package.json` scripts (or the project's equivalent), the README, and the dev port.
- where the UI text lives (i18n message files), so button names and labels come from it.

For "How to reproduce" you need **which screens or routes** were touched. Derive them from the
files:

- a route or page file → its URL on the dev server;
- a shared component → find who imports it and use that screen's URL;
- an API client, hook or query → the screen that consumes it;
- a backend-only change → test through the screen that calls the endpoint, or with `curl` when no screen does.

## Step 2: Write

Use exactly these sections, in this order. **A section with no real content is left out**: do
not write "N/A", do not write "no schema changes". Noise costs review time.

````markdown
## What changes

2 to 5 lines of prose. The observable behavior before and after. No file list here.

Closes <ticket id>.

## Where to look first

Table of only the files that need human judgment. Generated files, lockfiles, snapshots and
mechanical translations stay out.

| File | What to review |
|---|---|
| `src/lib/api/x.ts` | New Y logic: check the error path |

## Decisions worth discussing

Only what the reviewer might want to question: a modeling choice, an accepted trade-off,
something done in a non-obvious way. One line each, with the why.
Nothing questionable → cut the whole section.

## Watch out for

Real risk: migration, API contract change, change to existing behavior, something outside
the ticket's scope that came along, debt left on purpose.
No risk → cut the section.

## How to reproduce

### Setup

```bash
<the commands that start the app and anything it calls, with their ports>
```

Concrete preconditions (migration to run, seed needed, login role, data that must exist).
Credentials stay in the project's env files, not here.

### Steps

Numbered, imperative, one click per step. The reviewer does not know the feature: do not skip
navigation ("open X" before "click Y"). Each step with a visible effect ends with the
expected result.

1. Open `http://localhost:<port>/<route>`.
2. Click **<exact button>**.
   - Expected: <what appears>.

[SCREENSHOT HERE: <what the image should show>]

3. …

### Edge cases to check

The unhappy path the diff creates: validation, empty list, 409/422, a role that must not get
in, a value at the limit. One per line, with the expected result.

[SCREENSHOT HERE: <error state>]
````

## Rules

- Every `[SCREENSHOT HERE]` carries the description of what the image proves. A bare marker is
  useless. One per state worth evidence (new screen, error state, before/after), not one per step.
- Routes, button names and labels come from the code and its message files, not from memory.
  A wrong button name blocks the reviewer.
- When the change has two faces (for example two user roles), "How to reproduce" has two
  blocks of steps.
- Never cite a credential, token or env file content in the PR body.
- No generic "Checklist" section, no "Type of change: [ ] bug [ ] feature", no architecture
  tour. The reviewer has the diff.

## Step 3: Apply (only with `--apply`)

```bash
gh pr edit <n> --body-file <file>
```

Write the body to a temporary file in the scratchpad, never inline with quotes. Before
writing, show the Markdown and confirm with the user: `gh pr edit` overwrites the current
description with no backup.

End the body with the pull request attribution footer the session asks for, if any.
