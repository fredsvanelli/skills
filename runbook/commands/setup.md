---
description: Prepare this project for runbooks (folders, config, agents block, MCP servers)
argument-hint: ""
disable-model-invocation: true
---

# Runbook setup

Arguments: `$ARGUMENTS`

## Parameters

None. Run `/runbook:setup` on its own; running it again reconfigures the project and shows the diff of every file before writing.

Prepares the project so the other `/runbook:*` commands work. Running it again is safe: show the diff of every file you would change and write only after the user approves.

Read first: `${CLAUDE_PLUGIN_ROOT}/skills/runbook/references/config.md` and `${CLAUDE_PLUGIN_ROOT}/skills/runbook/references/commits.md`.

Run `git status --porcelain` now and keep the list: a file that is already dirty changes how its commit works (`commits.md`).

## 1. Detect

Collect without asking:

- Manifest and scripts: `package.json` or the project's equivalent.
- Framework. For Next.js, every `app/` folder with `page.*` or `route.*` files becomes an `entries` source with the `next-app-router` extractor; pick a glob that skips public marketing pages only when the user says so later.
- Sibling repos the app calls: an API base URL in `.env.example` plus a sibling folder holding that API's code. Offer it as an `entries` source with `root`, limited to the routes this app calls.
- Playwright: installed when `@playwright/test` is in the manifest's dependencies and a `playwright.config.*` exists; its `testDir` is the candidate for `paths.e2e`. Keep the result for the E2E question in step 2.
- Package manager: from the lockfile (`pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, else npm).
- UI text: i18n message files (`messages/*.json`, `locales/**`), default locale first.
- Integration branch: `develop` when `git rev-parse --verify origin/develop` succeeds, otherwise the default branch from `git symbolic-ref refs/remotes/origin/HEAD`. `git.protected` lists the default branch and the integration branch.
- Commit message convention: a commitlint config when present; otherwise the prefix pattern of `git log -20 --format=%s`. Write `git.messageFormat` with a `{summary}` placeholder in that pattern.
- Tools: `node --version` (needs 18+); existing `.mcp.json` servers; whether `mcp__claude-in-chrome__*` tools exist in this session.
- Agents file: whether `AGENTS.md` and `CLAUDE.md` exist and whether one is a symlink to the other (`readlink`).
- Slices: one slice per top-level feature folder of the UI routes, named after the folder, plus the matching API folders.

Done when every key in `config.md` has a detected value or sits on the question list for step 2.

## 2. Ask the open questions

One `AskUserQuestion` round, only for keys detection could not settle, each with your recommended value:

- `language` for runbook prose.
- `app.baseUrl` and `app.start`.
- `accounts`: role names and the env var names holding each email and password. Ask for names only.
- `mcp.secretsFile`, when it is not `.env.local`.
- The `commits` policy for `runbooks` and `setup`; suggest `ask` for both.
- Whether to add the two Playwright MCP servers to `.mcp.json`.
- Whether the project wants E2E tests with Playwright (always asked; recommend yes when Playwright is installed). When Playwright is installed, the question names its `testDir`.

E2E answer:

- **No**: `paths.e2e` is `null`, even when Playwright is installed.
- **Yes, installed**: `paths.e2e` is the detected `testDir`.
- **Yes, not installed**: ask one more question, install now (recommended) or later. Now: run `npm init playwright@latest -- --quiet --browser=chromium` (`pnpm create playwright`, `yarn create playwright` or `bun create playwright` with the same flags, by package manager), then read `paths.e2e` from the `testDir` of the config it created. Later: `paths.e2e` is `null`, and step 6 lists the install command.

## 3. Write

| Target | Source |
|---|---|
| `docs/runbooks/runbook.config.json` | `${CLAUDE_PLUGIN_ROOT}/templates/runbook.config.json` filled with steps 1 and 2 |
| `docs/runbooks/README.md` | `${CLAUDE_PLUGIN_ROOT}/templates/readme.md` |
| `docs/runbooks/_runs/.gitignore`, `docs/runbooks/_coverage/.gitignore` | two lines, `*` and `!.gitignore`: the folder is tracked, the reports in it stay local |
| `.gitignore` | add `.runbook/` when missing |
| agents block | `${CLAUDE_PLUGIN_ROOT}/templates/agents-block.md` |
| `.mcp.json` (when approved) | `${CLAUDE_PLUGIN_ROOT}/templates/mcp-servers.json` |

- Agents block: when one of `AGENTS.md` and `CLAUDE.md` is a symlink to the other, write once to the real file. Otherwise prefer `AGENTS.md` when it exists, else `CLAUDE.md`. Replace the text between `<!-- runbook:start -->` and `<!-- runbook:end -->` when the markers exist; otherwise append the block at the end of the file.
- `.mcp.json`: merge the two servers into `mcpServers`, keeping every existing server. Replace `<mcp.secretsFile>` and `<paths.evidence>`. Confirm the secrets file is ignored with `git check-ignore -q <file>`; when it is not, stop and tell the user, because the MCP server would read a tracked file.
- Report folders: when `git ls-files <paths.runbooks>/_runs <paths.runbooks>/_coverage` lists anything besides the two `.gitignore` files (reports or `.gitkeep` from an older setup), show the list and offer `git rm -r --cached --quiet -- <files>`. The files stay on disk; the removal goes into the setup commit.
- Plugin registration: when `${CLAUDE_PLUGIN_ROOT}` is inside this project, the plugin is in local development. Print `claude --plugin-dir <path relative to the project>` and leave `.claude/settings.json` alone. When it is outside (installed from a marketplace), add the marketplace to `extraKnownMarketplaces` and `"runbook@<marketplace>": true` to `enabledPlugins` in `.claude/settings.json`, keeping existing keys.

Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbook.mjs" entries` and `... requirements`. Fix the config until both exit 0 and every warning is understood.

Done when every target exists, `entries` prints at least one entry per source, and no warning is left unexplained.

## 4. Show the setup

Print the summary in the conversation before any commit question:

- the files written, each marked created or updated;
- the config fixes made in step 3 so `entries` and `requirements` exit 0, one line each, and the warnings left with their explanation;
- the entry count per source and per slice.

## 5. Commit

Commit by the `setup` policy. Ask an `ask` question only after the summary from step 4 is on screen; the question names the files and the message and does not repeat the summary.

## 6. Close

Tell the user:

- the commit outcome: the short sha, or the paths left uncommitted;
- tools missing, each with its install command (Node 18+, `npx @playwright/mcp@0.0.83 --help` to pre-fetch the MCP server, the Playwright install command from step 2 when E2E was wanted but not installed);
- what needs a restart: new `.mcp.json` servers load in a new session or through `/mcp`.

Install nothing without asking; the only install setup runs itself is Playwright, after a yes in step 2. Offer `/runbook:coverage` for a coverage baseline.

Done when the user has seen the summary before any commit question.
