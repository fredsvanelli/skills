# generate-pr-description: capture its own screenshots

Status: approved (short design, small change).

## Intent

`utils:generate-pr-description` leaves `[SCREENSHOT HERE: <what the image proves>]` markers for the
author to fill by hand. The author rarely does. The skill already knows how to start the app and
which routes the diff touches, so it can take the screenshots itself and link them in the body.

## Goals

- Each marker the skill would write becomes a real image when the session has a browser tool and
  the screen is reachable.
- Full page or only the section/component, whichever proves the marker's description better.
- Images render in the PR body, private repos included, for logged-in viewers.

## Non-goals

- No new dependency, no bundled capture script, no helper file for publishing.
- No login automation beyond what the session can already do with the project's dev setup.
- No image diffing, before/after automation or video.

## Anti-goals

- A screenshot showing a token, secret or real personal data.
- Screenshots committed to the PR branch (they would land in its diff and in `main`'s history).
- Pushing to the remote without the user's confirmation.

## Approaches

| Approach | Trade-off | Verdict |
|---|---|---|
| Instructions in `SKILL.md`, agent drives whatever browser tool the session has | Works with claude-in-chrome, Playwright MCP, Orca, Codex's tool; reaches states behind clicks | **Picked** |
| Bundled `npx playwright screenshot` script | No login, no clicks, no error/modal states; adds a download | Rejected |
| Separate helper script for publishing | The git plumbing is ~6 lines | Rejected: inline |

Storage (user's pick, out of four): an orphan branch `pr-assets`, linked by commit SHA. Rejected:
commit on the PR branch (pollutes the diff), local only (still manual), upload through the GitHub
UI with claude-in-chrome (fragile, needs Chrome).

## Design

1. **When.** Wherever the procedure would write `[SCREENSHOT HERE: X]`, it first tries to capture X
   with the browser tool the session has. It keeps the marker unchanged when there is no browser
   tool, the app does not start, the screen is unreachable (login it cannot do, data that does not
   exist), or the screen would show a secret or real personal data.
2. **What.** Full page or element, whichever proves X better. Files saved in the scratchpad as
   `<n>-<slug-of-X>.png`.
3. **Publish.** Git plumbing, no checkout, working tree untouched: hash each file, build a tree
   with `<branch-slug>/<file>` entries on top of the current `origin/pr-assets` tree (or an empty
   tree), `git commit-tree` with `origin/pr-assets` as parent when it exists (orphan otherwise),
   `git push origin <sha>:refs/heads/pr-assets`. A rejected push: fetch, rebuild on the new tip,
   push once more; a second failure keeps the markers.
4. **Link.** `![X](https://github.com/<owner>/<repo>/blob/<sha>/<path>?raw=true)`. The commit stays
   reachable from `pr-assets`, so GC never drops it.
5. **Confirmation.** The push publishes. With `--apply` it joins the existing confirmation before
   `gh pr edit`. Without `--apply`, ask once before the push. On a no, keep the marker and add the
   local file path after it.
6. **No GitHub remote** (`gh repo view` fails): keep the markers.
7. **Docs and version.** Update the skill's `description`, `utils/README.md`, `utils/CHANGELOG.md`;
   bump utils to 0.7.0 in `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json`.

## Left to the builder

- Exact wording of the steps in `SKILL.md`, and where they sit (Step 2 rules plus a new step
  between Write and Apply).
- The exact plumbing commands, as long as they never touch the working tree or index of the
  user's checkout (use a temporary `GIT_INDEX_FILE`).
