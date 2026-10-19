---
description: Prepare this project for runbooks (stack, test libraries, folders, config, agents block, MCP servers)
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

- Manifest and scripts: `package.json`, `composer.json` or the project's equivalent.
- Stack candidate: screens (`page.*`, views, `resources/js`, a SPA entry) suggest `ui`; endpoints (`route.*` handlers, `@Controller`, `routes/api.php`, Express routers) suggest `api`; both suggest `fullstack`. Keep it for the stack question in step 2.
- Technology per surface, from the manifest: `next`, `nest` (`@nestjs/core`), `express`, `fastify`, `laravel` (`laravel/framework`), `php`, ... Keep it for step 2.
- Framework. For Next.js, every `app/` folder with `page.*` or `route.*` files becomes an `entries` source with the `next-app-router` extractor; pick a glob that skips public marketing pages only when the user says so later. For other backends, a `regex` source over the route files with `"kind": "api-endpoint"` (`config.md`, Tests).
- Sibling repos the app calls: an API base URL in `.env.example` plus a sibling folder holding that API's code. Offer it as an `entries` source with `root`, limited to the routes this app calls. When the stack has `api`, its tests become `tests.api` with the same `root`.
- Test libraries already installed, per surface: `@playwright/test` with a `playwright.config.*` (its `testDir`), `cypress` with a `cypress.config.*` (its `specPattern`), `jest`, `vitest`, `supertest`, `phpunit/phpunit` (`phpunit.xml`), `pestphp/pest`. Their folders are candidates for `tests.<surface>.dir`. Keep the result for step 2.
- Existing tests of the `api` surface: two or three, to fill the API scripts checklist in step 3 (isolation, data, auth, requests, fakes).
- Package manager: from the lockfile (`pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, else npm).
- UI text: i18n message files (`messages/*.json`, `locales/**`), default locale first.
- Integration branch: `develop` when `git rev-parse --verify origin/develop` succeeds, otherwise the default branch from `git symbolic-ref refs/remotes/origin/HEAD`. `git.protected` lists the default branch and the integration branch.
- Commit message convention: a commitlint config when present; otherwise the prefix pattern of `git log -20 --format=%s`. Write `git.messageFormat` with a `{summary}` placeholder in that pattern.
- Tools: `node --version` (needs 18+); existing `.mcp.json` servers; whether `mcp__claude-in-chrome__*` tools exist in this session.
- Agents file: whether `AGENTS.md` and `CLAUDE.md` exist and whether one is a symlink to the other (`readlink`).
- An existing config: its `stack`, and `paths.e2e`, which step 3 migrates to `tests.ui.dir`.
- Slices: one slice per top-level feature folder of the UI routes, named after the folder, plus the matching API folders. Without UI routes (a `backend` candidate), one slice per feature folder of the endpoints, named after it, merging the same feature across route prefixes (`admin/internal/invoices/**`, `admin/partner/invoices/**` and `v1/invoices/**` form the slice `invoices`). Endpoints above any feature folder (`GET /`, `GET /v1`, `GET /admin/me`) stay without a slice; list them in step 4.

Done when every key in `config.md` has a detected value or sits on the question list for step 2.

## 2. Ask the open questions

Ask with `AskUserQuestion`, each question with your recommended value. `AskUserQuestion` takes four questions per call, so ask in rounds. When detection found both screens and endpoints, or the endpoints live in a sibling repo, ask the stack alone first, because it decides the rest. When it found only one of them, the stack is settled enough to ask together with the questions it leads to: one call with the stack, the tech, the framework and its install, and `language` when there is room; the remaining questions follow in the next round.

**Stack, always asked:** `stack` (`frontend`, `backend`, `fullstack`), recommending the detected candidate. When the answer adds `api` to an existing `ui` project, say that endpoint coverage will drop on the next `/runbook:coverage`, because endpoints then count only through `api` runbooks (`references/coverage.md`, By surface).

**Per surface the stack allows:**

- `tech`, recommending the detected one.
- `framework`, recommending what is installed; when nothing is: `ui` → Playwright; `nest`, `express`, `fastify` → Jest with supertest; another Node or Vite project → Vitest; `laravel` → PHPUnit (Pest when `pestphp/pest` is installed); plain `php` → PHPUnit. For `ui`, offer also "none": the project wants no UI test scripts, and `tests.ui` stays out of the config.
- When the chosen framework is not installed: install now (recommended) or later. Now: run its installer by package manager (`npm init playwright@latest -- --quiet --browser=chromium` or `pnpm create playwright` / `yarn create playwright` / `bun create playwright` with the same flags; `npm i -D cypress`; `npm i -D jest jest-junit supertest`; `npm i -D vitest`; `composer require --dev phpunit/phpunit` or `pestphp/pest`), then read `dir` from the config it created. Later: write the `tests.<surface>` block anyway and list the command in step 6. An `api` surface cannot run without it.
- `dir` and `command` come from detection and `config.md` (Tests, JUnit flags by framework). Ask only when detection leaves them open. Jest needs `jest-junit` for the JUnit report; offer to add it.
- `tests.api.baseUrl` only when the chosen `api` framework calls a running server (Playwright `request`, `cy.request`, supertest against a URL).

**Then, only for keys detection could not settle:**

- `language` for runbook prose.
- The `commits` policy for `runbooks` and `setup`; suggest `ask` for both.
- When the stack has `ui`: `app.baseUrl` and `app.start`; `accounts` (role names and the env var names holding each email and password; ask for names only); `mcp.secretsFile`, when it is not `.env.local`; whether to add the two Playwright MCP servers to `.mcp.json`.

A `backend` stack skips every browser question.

## 3. Write

| Target | Source |
|---|---|
| `docs/runbooks/runbook.config.json` | `${CLAUDE_PLUGIN_ROOT}/templates/runbook.config.json` filled with steps 1 and 2 |
| `docs/runbooks/README.md` | `${CLAUDE_PLUGIN_ROOT}/templates/readme.md` |
| `docs/runbooks/_runs/.gitignore` | two lines, `*` and `!.gitignore`: the folder is tracked, the reports in it stay local |
| `docs/runbooks/_coverage/.gitignore` | two lines, `*` and `!.gitignore`: the folder is tracked, the reports in it stay local |
| `.gitignore` | add `.runbook/`, `/<paths.runbooks>/runs.*` and `/<paths.runbooks>/coverage.*` when missing: the summary files stay local |
| agents block | `${CLAUDE_PLUGIN_ROOT}/templates/agents-block.md`, with `${CLAUDE_PLUGIN_ROOT}/templates/api-practices.md` filled in when the stack has `api` |
| `.mcp.json` (when approved and the stack has `ui`) | `${CLAUDE_PLUGIN_ROOT}/templates/mcp-servers.json` |

- Config: write `stack` and one `tests.<surface>` block per surface that has a framework. Drop `paths.e2e`; its value moves to `tests.ui.dir` when there is no `tests.ui` yet.
- Agents block: when one of `AGENTS.md` and `CLAUDE.md` is a symlink to the other, write once to the real file. Otherwise prefer `AGENTS.md` when it exists, else `CLAUDE.md`. Replace the text between `<!-- runbook:start -->` and `<!-- runbook:end -->` when the markers exist; otherwise append the block at the end of the file.
- API scripts checklist: when the stack has `api`, replace the `<!-- api-scripts: ... -->` line of the block with `api-practices.md`, every placeholder filled with what this project does, citing the helper and its path, from the tests read in step 1. When the project has no `api` tests yet, fill it with the usual practice of the chosen `tech` and `framework` and say so in the summary. Without `api`, delete the line. Cover how scripts are written only; the project's own conventions for backend code are not this block's business.
- Test command: when `tests.<surface>.command` is set and the framework is installed, run it once with `{files}` set to one existing test of that surface (or an empty run when there is none) and `{junit}` set to `.runbook/junit/setup.xml`, and confirm the file appears. Fix the command until it does.
- `.mcp.json`: merge the two servers into `mcpServers`, keeping every existing server. Replace `<mcp.secretsFile>` and `<paths.evidence>`. Confirm the secrets file is ignored with `git check-ignore -q <file>`; when it is not, stop and tell the user, because the MCP server would read a tracked file.
- Report folders: when `git ls-files <paths.runbooks>/_runs <paths.runbooks>/_coverage` lists anything besides the two `.gitignore` files (reports, `.gitkeep` or `_runs/output.*` from an older setup), show the list and offer `git rm -r --cached --quiet -- <files>`. The files stay on disk; the removal goes into the setup commit.
- Plugin registration: when `${CLAUDE_PLUGIN_ROOT}` is inside this project, the plugin is in local development. Print `claude --plugin-dir <path relative to the project>` and leave `.claude/settings.json` alone. When it is outside (installed from a marketplace), add the marketplace to `extraKnownMarketplaces` and `"runbook@<marketplace>": true` to `enabledPlugins` in `.claude/settings.json`, keeping existing keys.

Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbook.mjs" entries` and `... requirements`. Fix the config until both exit 0 and every warning is understood.

Done when every target exists, `entries` prints at least one entry per source, and no warning is left unexplained.

## 4. Show the setup

Print the summary in the conversation before any commit question:

- the files written, each marked created or updated;
- the config fixes made in step 3 so `entries` and `requirements` exit 0, one line each, and the warnings left with their explanation;
- the entry count per source and per slice, and the endpoints left without a slice;
- the stack and, per surface, the tech, framework, dir and command, with the test command check from step 3;
- when the stack now has `api` and had not before: endpoint coverage drops on the next `/runbook:coverage`, and why.

## 5. Commit

Commit by the `setup` policy. Ask an `ask` question only after the summary from step 4 is on screen; the question names the files and the message and does not repeat the summary.

## 6. Close

Tell the user:

- the commit outcome: the short sha, or the paths left uncommitted;
- tools missing, each with its install command (Node 18+, `npx @playwright/mcp@0.0.83 --help` to pre-fetch the MCP server when the stack has `ui`, the install command from step 2 of each framework left for later);
- what needs a restart: new `.mcp.json` servers load in a new session or through `/mcp`.

Install nothing without asking; the only installs setup runs itself are the test libraries, after a yes in step 2. Offer `/runbook:coverage` for a coverage baseline.

Done when the user has seen the summary before any commit question.
