---
name: generate-pr-description
description: "Write a pull request description from the branch's real diff, for the reviewer: what changes, where to look first, risks, and a 'How to reproduce' with manual steps and screenshots it takes itself with the session's browser tool (published to a pr-assets branch), or [SCREENSHOT HERE] markers when it cannot. Use when the user types /utils:generate-pr-description or asks to write the PR description, the PR body, or describe this branch for review. --apply writes it to the PR with gh."
argument-hint: "[--base <branch>] [--apply] [--pr <number>]"
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
---

# Write a PR description

Before following this procedure, read [runtime setup](../../references/runtime.md). Resolve the plugin root from this file's real location and use the active host's tools and argument handling. Do this also when this entry is invoked directly.

Reads the branch's real diff and writes the PR description **for the reviewer**, not for the
author. The bar: the reviewer understands what changed, where to look first, and can test it
by hand without asking anything. Where the reviewer needs to see a state, it takes the screenshot
itself when the session can (Step 3) and leaves a `[SCREENSHOT HERE]` marker when it cannot.

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

Without `--apply`, it prints the Markdown in the chat and changes no PR. To take screenshots it may
start the app locally and write to the local dev database through the app's own forms; it pushes
the images to `pr-assets` only after asking (Step 3).

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
  The same holds for a captured image: its alt text is that description.
- Routes, button names and labels come from the code and its message files, not from memory.
  A wrong button name blocks the reviewer.
- When the change has two faces (for example two user roles), "How to reproduce" has two
  blocks of steps.
- Never cite a credential, token or env file content in the PR body.
- No generic "Checklist" section, no "Type of change: [ ] bug [ ] feature", no architecture
  tour. The reviewer has the diff.

## Step 3: Screenshots

Every `[SCREENSHOT HERE: X]` Step 2 wrote is a capture to try. Keep the marker exactly as written
whenever any of these holds, and go on with the rest:

- `gh repo view "$(git remote get-url origin)" --json nameWithOwner,visibility` fails (no GitHub
  remote). Check this first: it rules out every capture. Always name `origin`: it is the remote the
  images are pushed to, and a bare `gh repo view` picks `upstream` in a fork;
- the session has no browser tool (claude-in-chrome, a Playwright MCP, Orca's browser, Codex's
  browser tool, or similar);
- the app does not start, or does not answer on `localhost` / `127.0.0.1`;
- the state X is unreachable: a login the session cannot do, data it cannot create;
- the screen would show a token, a secret or real personal data;
- X is the "before" of a before/after: only the branch's state is captured, never the base's;
- reaching X needs a migration, seed or reset of the dev database.

### Capture

1. If the app already answers on its dev port, use it. Otherwise start it with the Setup commands
   from "How to reproduce", and stop what you started when the captures are done. Never run a
   migration, seed or reset. Drive only `localhost` or `127.0.0.1`, never a staging, production or
   other remote URL, even one the README cites.
2. Log in only with a session the browser already has or a dev user the project documents (README,
   seed file). Never read `.env` or another env file for a password.
3. Follow the steps you wrote to reach X. Filling forms and submitting is fine: it writes to the
   local dev database only.
4. Capture at 1280x800. Take the full page when X is about the layout or a whole screen; take only
   the element when X is about one component, message or field. Add one capture at 390 wide only
   when the diff touches responsive CSS or breakpoints.
   Resize the window first. A tool that captures only the viewport gives the visible part of the
   page, which is fine.
5. Make one fresh, empty folder for this run (`mktemp -d`, inside the scratchpad when the session
   has one). Copy each kept capture into it as `<n>-<slug-of-X>.png`, numbered in the order the
   images appear in the body, converting to PNG when the tool saved another format. Everything in
   this folder gets pushed: a capture you reject (it shows a secret, the wrong state) never goes in,
   or is deleted from it before Confirm.

### Confirm

Pushing publishes the images. List exactly what will be pushed (`ls "$SHOTS"/*.png`, absolute
paths), ask the user to open them, and state the repository's visibility from `gh repo view`: in a
public repository the images stay public forever, even after the PR closes; `pr-assets` is never
rewritten.

Without `--apply`, ask yes or no. With `--apply`, this is the same question as Step 4's
confirmation, with three answers: apply with the images, apply without them, or cancel.

Without the images (a no, or "apply without them"), keep each marker and append the local file
path: `[SCREENSHOT HERE: X] (local: <path>)`.

### Publish

In one shell call (variables do not survive between calls), `export SHOTS=<the run's folder>
SLUG=<slug>`, then run this block as is from the consumer repository. It runs in `bash` whatever the
calling shell is. It never touches the working tree or the index: it builds a commit on top of the
remote `pr-assets` tip (an orphan one when the branch does not exist yet), pushes it without the
repository's push hooks, and prints its SHA. A rejected push (someone pushed meanwhile) is rebuilt
on the new tip once; a second failure prints git's error.

```bash
bash <<'EOF'
set -eu
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
export GIT_INDEX_FILE="$tmp/index"
for try in 1 2; do
  parent=$(git fetch -q origin pr-assets 2>/dev/null && git rev-parse FETCH_HEAD || true)
  if [ -n "$parent" ]; then git read-tree "$parent"; else git read-tree --empty; fi
  for f in "$SHOTS"/*.png; do
    git update-index --add --cacheinfo "100644,$(git hash-object -w "$f"),$SLUG/$(basename "$f")"
  done
  sha=$(git commit-tree "$(git write-tree)" ${parent:+-p "$parent"} -m "assets: $SLUG")
  if git push -q --no-verify origin "$sha:refs/heads/pr-assets" 2>"$tmp/err"; then echo "$sha"; exit 0; fi
done
cat "$tmp/err" >&2; exit 1
EOF
```

`SLUG` is the branch name with every `/` replaced by `-`. When the block exits non-zero, tell the user
git's error and keep the markers with their local paths, as on a no.

### Link

Replace each marker with the image, using `nameWithOwner` from `gh repo view` and the SHA the block
printed. The `blob/...?raw=true` form renders in private repositories for logged-in viewers, and the
SHA keeps the link to this exact image even after a later run replaces the file:

```markdown
![X](https://github.com/<owner>/<repo>/blob/<sha>/<SLUG>/<n>-<slug-of-X>.png?raw=true)
```

## Step 4: Apply (only with `--apply`)

```bash
gh pr edit <n> --body-file <file>
```

Write the body to a temporary file in the scratchpad, never inline with quotes. Before
writing, show the Markdown and confirm with the user: `gh pr edit` overwrites the current
description with no backup. When Step 3 has captures to push, ask this together with Step 3's
question (the Markdown still has the markers then), before the push; do not ask again here.

End the body with the pull request attribution footer the session asks for, if any.
