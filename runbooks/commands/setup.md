---
description: Prepare this project for runbooks (stack, test libraries, design reference, folders, config, agents block, MCP servers)
argument-hint: ""
disable-model-invocation: true
---

# Runbook setup

Arguments: `$ARGUMENTS`

## Parameters

None. Run `/runbooks:setup` on its own; running it again reconfigures the project and shows the diff of every file before writing. To change one part of the config, such as the design reference or the commit policy, `/runbooks:settings` asks only about that part.

Prepares the project so the other `/runbooks:*` commands work. Running it again is safe: show the diff of every file you would change and write only after the user approves.

Read first: `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/config.md` and `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/commits.md`.

Run `git status --porcelain` now and keep the list: a file that is already dirty changes how its commit works (`commits.md`).

## 1. Detect

Collect without asking:

- Manifest and scripts: `package.json`, `composer.json` or the project's equivalent.
- Stack candidate: screens (`page.*`, views, `resources/js`, a SPA entry) suggest `ui`; endpoints (`route.*` handlers, `@Controller`, `routes/api.php`, Express routers) suggest `api`; both suggest `fullstack`. Keep it for the stack question in step 2.
- Technology per surface, from the manifest: `next`, `nest` (`@nestjs/core`), `express`, `fastify`, `laravel` (`laravel/framework`), `php`, ... Keep it for step 2.
- Framework. For Next.js, every `app/` folder with `page.*` or `route.*` files becomes an `entries` source with the `next-app-router` extractor; pick a glob that skips public marketing pages only when the user says so later. For other backends, a `regex` source over the route files with `"kind": "api-endpoint"` (`config.md`, Tests).
- Sibling repos the app calls: an API base URL in `.env.example` plus a sibling folder holding that API's code. Offer it as an `entries` source with `root`, limited to the routes this app calls. When the stack has `api`, its tests become `tests.api` with the same `root`.
- Test libraries already installed, per surface: `@playwright/test` with a `playwright.config.*` (its `testDir`), `cypress` with a `cypress.config.*` (its `specPattern`), `jest`, `vitest`, `supertest`, `phpunit/phpunit` (`phpunit.xml`), `pestphp/pest`. Their folders are candidates for `tests.<surface>.dir`. Keep the result for step 2.
- Upstream API, when the stack has `ui`: where the app reads its URL, from the keys of `.env.example` that end in `API_URL` or `API_BASE_URL` (for `upstream.urlEnv`); whether the upstream API runs in the app's own process (Next.js route handlers, Laravel with Blade or Inertia), which needs no `upstream` block; and request interception already in the tests (`page.route`, `cy.intercept`, `msw`). An existing config's `upstream`.
- Existing tests of the `api` surface: two or three, to fill the API scripts checklist in step 3 (isolation, data, auth, requests, fakes).
- Package manager: from the lockfile (`pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, else npm).
- UI text: i18n message files (`messages/*.json`, `locales/**`), default locale first.
- Integration branch: `develop` when `git rev-parse --verify origin/develop` succeeds, otherwise the default branch from `git symbolic-ref refs/remotes/origin/HEAD`. `git.protected` lists the default branch and the integration branch.
- Commit message convention: a commitlint config when present; otherwise the prefix pattern of `git log -20 --format=%s`. Write `git.messageFormat` with a `{summary}` placeholder in that pattern.
- Tools: `node --version` (needs 18+); existing `.mcp.json` servers; whether `mcp__claude-in-chrome__*` tools exist in this session.
- Design reference, for the design question in step 2: a design server in `.mcp.json` (Figma, Penpot, Sketch); design links in the README, docs and code (`figma.com/design/`, `figma.com/file/`, `xd.adobe.com/view/`, `claude.ai/design`); folders of exported designs (`design/`, `designs/`, `mockups/`, images named after screens); `.fig`, `.xd`, `.sketch` or `.pen` files. An existing config's `design`.
- Agents file: whether `AGENTS.md` and `CLAUDE.md` exist and whether one is a symlink to the other (`readlink`).
- An existing config: its `stack`, and `paths.e2e`, which step 3 migrates to `tests.ui.dir`. A project set up before the plugin was renamed from `runbook` to `runbooks` has `docs/runbooks/runbook.config.json` instead; read that one, and step 3 migrates it.
- Slices: one slice per top-level feature folder of the UI routes, named after the folder, plus the matching API folders. Without UI routes (a `backend` candidate), one slice per feature folder of the endpoints, named after it, merging the same feature across route prefixes (`admin/internal/invoices/**`, `admin/partner/invoices/**` and `v1/invoices/**` form the slice `invoices`). Endpoints above any feature folder (`GET /`, `GET /v1`, `GET /admin/me`) stay without a slice; list them in step 4.

Done when every key in `config.md` has a detected value or sits on the question list for step 2.

## 2. Ask the open questions

Ask with `AskUserQuestion`, each question with your recommended value. `AskUserQuestion` takes four questions per call, so ask in rounds. When detection found both screens and endpoints, or the endpoints live in a sibling repo, ask the stack alone first, because it decides the rest. When it found only one of them, the stack is settled enough to ask together with the questions it leads to: one call with the stack, the tech, the framework and its install, and `language` when there is room; the remaining questions follow in the next round.

**Stack, always asked:** `stack` (`frontend`, `backend`, `fullstack`), recommending the detected candidate. When the answer adds `api` to an existing `ui` project, say that endpoint coverage will drop on the next `/runbooks:coverage`, because endpoints then count only through `api` runbooks (`references/coverage.md`, By surface).

**Design reference, right after the stack, when it has `ui`:** ask whether the project has a design system the screens follow. Options: Figma, Claude Design, Adobe XD, Local files, recommending what detection found. The question names what detection found, or says it found nothing, and says the user can answer "none" or name another tool (Penpot, Sketch, Framer, ...) under "Other". With an existing `design`, recommend keeping it.

Then offer to connect it, in the next round:

- **Figma.** When `.mcp.json` already has a Figma server, use it. Otherwise ask which server to add, from `config.md`, Design: the remote server (recommended), the desktop server, the Framelink package, or exported files in the repository, which continue as Local files with `system: figma`. Then ask for the Figma file the screens come from, as a link typed under "Other", for `design.url`; the user may skip it.
- **Claude Design.** There is no server to add: the Artifact tool reads the designs, with Claude Code signed in to claude.ai. When this session has no Artifact tool, say the user needs `/login` with a claude.ai account. Ask for the design's link for `design.url`; the user may skip it.
- **Adobe XD.** Adobe XD has no MCP server. Say so, and offer exported artboards: File > Export > All Artboards as PNG, into a folder of the repository. Then continue as Local files with `system: adobe-xd`.
- **Local files.** Ask for the folder, recommending the one detection found, and write a glob of its images and PDFs to `design.files`.
- **Another tool.** Ask whether it has an MCP server or a package that runs one. When it has, ask for its command or URL, and the env var names of any token it needs, never the values; it goes into `.mcp.json` under the tool's name, with `system: other`, `name` and `mcp`. When it has none, offer exported files, as Local files with `system: other`.
- **None.** `design` stays `null`.

**Per surface the stack allows:**

- `tech`, recommending the detected one.
- `framework`, recommending what is installed; when nothing is: `ui` → Playwright; `nest`, `express`, `fastify` → Jest with supertest; another Node or Vite project → Vitest; `laravel` → PHPUnit (Pest when `pestphp/pest` is installed); plain `php` → PHPUnit. For `ui`, offer also "none": the project wants no UI test scripts, and `tests.ui` stays out of the config.
- When the chosen framework is not installed: install now (recommended) or later. Now: run its installer by package manager (`npm init playwright@latest -- --quiet --browser=chromium` or `pnpm create playwright` / `yarn create playwright` / `bun create playwright` with the same flags; `npm i -D cypress`; `npm i -D jest jest-junit supertest`; `npm i -D vitest`; `composer require --dev phpunit/phpunit` or `pestphp/pest`), then read `dir` from the config it created. Later: write the `tests.<surface>` block anyway and list the command in step 6. An `api` surface cannot run without it.
- `dir` and `command` come from detection and `config.md` (Tests, JUnit flags by framework). Ask only when detection leaves them open. Jest needs `jest-junit` for the JUnit report; offer to add it.
- `tests.api.baseUrl` only when the chosen `api` framework calls a running server (Playwright `request`, `cy.request`, supertest against a URL).

**Upstream mode, right after the `ui` framework, when the stack has `ui`:** ask it only when the upstream API runs outside the app's own process (a sibling repo, a remote URL, a third party). When it runs inside, ask nothing and write no `upstream` block, which means `live`. Options: `live`, `mocked`. Recommend, in this order:

- `mocked` when the project's tests already intercept requests (`page.route`, `cy.intercept`, `msw`);
- `live` when the sibling repo starts locally;
- `mocked` when the API is remote or third party only.

With an existing `upstream.mode`, recommend keeping it. The question text explains both modes in one line each (`${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/upstream.md`, Modes). When the answer is `mocked`, the question text also says that the endpoints of the sibling repo then count as covered only through `live` runbooks, because a mocked runbook covers no endpoint (`${CLAUDE_PLUGIN_ROOT}/docs/adr/0004-mocked-runbooks-never-cover-endpoints.md`), so endpoint coverage drops on the next `/runbooks:coverage`. When the project has no `tests.ui`, the question text also warns that no automated run checks the fixtures, and that only `runbooks.mjs fixtures` with a schema, or `list --affected`, notices an API change.

Then ask the keys of the block, in the next round:

- `upstream.urlEnv`, recommending the key found in `.env.example`. Required for `mocked`.
- `upstream.baseUrl`, the upstream API's URL, recommending the value detection found.
- `upstream.start` and `upstream.root`, when the sibling repo is local. In a `fullstack` stack, `upstream.root` takes `tests.api.root` without a question.
- `upstream.schema`, a local OpenAPI 3 JSON file, and `upstream.redactHeaders`, only when detection left them open. The user may skip both.

Keys not asked keep their defaults from `config.md`, Upstream.

**Then, only for keys detection could not settle:**

- `language` for runbook prose.
- The `commits` policy for `runbooks` and `setup`; suggest `ask` for both.
- When the stack has `ui`: `app.baseUrl` and `app.start`; `accounts` (role names and the env var names holding each email and password; ask for names only); `mcp.secretsFile`, when it is not `.env.local`; whether to add the two Playwright MCP servers to `.mcp.json`.

A `backend` stack skips every browser question.

## 3. Write

| Target | Source |
|---|---|
| `docs/runbooks/runbooks.config.json` | `${CLAUDE_PLUGIN_ROOT}/templates/runbooks.config.json` filled with steps 1 and 2 |
| `docs/runbooks/README.md` | `${CLAUDE_PLUGIN_ROOT}/templates/readme.md` |
| `docs/runbooks/_runs/.gitignore` | two lines, `*` and `!.gitignore`: the folder is tracked, the reports in it stay local |
| `docs/runbooks/_coverage/.gitignore` | two lines, `*` and `!.gitignore`: the folder is tracked, the reports in it stay local |
| `.gitignore` | add `.runbooks/`, `/<paths.runbooks>/runs.*` and `/<paths.runbooks>/coverage.*` when missing: the summary files stay local |
| agents block | `${CLAUDE_PLUGIN_ROOT}/templates/agents-block.md`, with `${CLAUDE_PLUGIN_ROOT}/templates/api-practices.md` filled in when the stack has `api` |
| `.mcp.json` (when approved and the stack has `ui`) | `${CLAUDE_PLUGIN_ROOT}/templates/mcp-servers.json`, plus the design server from step 2 (`${CLAUDE_PLUGIN_ROOT}/templates/design-servers.json` for Figma) |

- Rename from `runbook`: when step 1 found `docs/runbooks/runbook.config.json`, move it with `git mv` to `runbooks.config.json`. In the config, `paths.evidence` `.runbook/evidence` becomes `.runbooks/evidence`, and `mcp.headless`/`mcp.headed` `runbook-playwright`/`runbook-playwright-headed` become `runbooks-playwright`/`runbooks-playwright-headed`. Rename those two servers in `.mcp.json` too, replace `.runbook/` with `.runbooks/` in the root `.gitignore`, replace the `<!-- runbook:start -->` and `<!-- runbook:end -->` markers with the new ones, and replace `runbook@<marketplace>` with `runbooks@<marketplace>` in `enabledPlugins`. Move a local `.runbook/` folder to `.runbooks/`.
- Config: write `stack` and one `tests.<surface>` block per surface that has a framework. Drop `paths.e2e`; its value moves to `tests.ui.dir` when there is no `tests.ui` yet. Keep the existing `viewports`: `create` writes them. Write `design` from step 2, or keep the existing one when the user kept it.
- Upstream: when step 2 asked the mode, write the `upstream` block with the answers and leave the other keys out so they keep their defaults (`config.md`, Upstream). Keep the existing block's keys that the user kept. In a `backend` stack the block is a config error, so write none.
- Upstream server: copy only when `tests.ui` exists and some runbook can be mocked, that is when the default `upstream.mode` is `mocked` or the user says some runbooks will be mocked. Ask that only when the default is `live`. A live-only project gets no copy and `upstream.serverFile` stays null. Then copy `${CLAUDE_PLUGIN_ROOT}/scripts/upstream-server.mjs` to `<tests.ui.dir>/runbooks-upstream.mjs` and write that path to `upstream.serverFile`, so CI runs mocked scripts without the plugin. When the file exists, show its diff first; running `setup` again is how the copy is refreshed. Do not edit the framework config. Show how the framework starts the copy, with the app's `upstream.urlEnv` set to `http://127.0.0.1:<upstream.port>`:
  - Playwright: a `webServer` entry whose `command` is `node <tests.ui.dir>/runbooks-upstream.mjs --fixtures <upstream.fixtures> --port <upstream.port>` and whose `url` is `http://127.0.0.1:<upstream.port>/__runbooks/state`.
  - Cypress: a child process started in `setupNodeEvents` with the same command.
  - Add `--target <upstream.baseUrl>` to the command for `live` or `record` runs, and `--redact <upstream.redactHeaders>` when the list is not empty. The server prints `runbooks-upstream listening on http://127.0.0.1:<port>`.
- Agents block: when one of `AGENTS.md` and `CLAUDE.md` is a symlink to the other, write once to the real file. Otherwise prefer `AGENTS.md` when it exists, else `CLAUDE.md`. Replace the text between `<!-- runbooks:start -->` and `<!-- runbooks:end -->` when the markers exist; otherwise append the block at the end of the file.
- API scripts checklist: when the stack has `api`, replace the `<!-- api-scripts: ... -->` line of the block with `api-practices.md`, every placeholder filled with what this project does, citing the helper and its path, from the tests read in step 1. When the project has no `api` tests yet, fill it with the usual practice of the chosen `tech` and `framework` and say so in the summary. Without `api`, delete the line. Cover how scripts are written only; the project's own conventions for backend code are not this block's business.
- Test command: when `tests.<surface>.command` is set and the framework is installed, run it once with `{files}` set to one existing test of that surface (or an empty run when there is none) and `{junit}` set to `.runbooks/junit/setup.xml`, and confirm the file appears. Fix the command until it does.
- Design server: write the chosen template to `mcpServers` under the name `figma`, or the other tool's server under its name, and set `design.mcp` to that name. For Framelink, replace `<version>` with what `npm view figma-developer-mcp version` prints. A token stays in the user's environment: `.mcp.json` holds only `${NAME}`.
- `.mcp.json`: merge the two servers into `mcpServers`, keeping every existing server. Replace `<mcp.secretsFile>` and `<paths.evidence>`. Confirm the secrets file is ignored with `git check-ignore -q <file>`; when it is not, stop and tell the user, because the MCP server would read a tracked file.
- Report folders: when `git ls-files <paths.runbooks>/_runs <paths.runbooks>/_coverage` lists anything besides the two `.gitignore` files (reports, `.gitkeep` or `_runs/output.*` from an older setup), show the list and offer `git rm -r --cached --quiet -- <files>`. The files stay on disk; the removal goes into the setup commit.
- Plugin registration: when `${CLAUDE_PLUGIN_ROOT}` is inside this project, the plugin is in local development. Print `claude --plugin-dir <path relative to the project>` and leave `.claude/settings.json` alone. When it is outside (installed from a marketplace), add the marketplace to `extraKnownMarketplaces` and `"runbooks@<marketplace>": true` to `enabledPlugins` in `.claude/settings.json`, keeping existing keys.

Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" entries` and `... requirements`. Fix the config until both exit 0 and every warning is understood.

Done when every target exists, `entries` prints at least one entry per source, and no warning is left unexplained.

## 4. Show the setup

Print the summary in the conversation before any commit question:

- the files written, each marked created or updated;
- the config fixes made in step 3 so `entries` and `requirements` exit 0, one line each, and the warnings left with their explanation;
- the entry count per source and per slice, and the endpoints left without a slice;
- the stack and, per surface, the tech, framework, dir and command, with the test command check from step 3;
- the design reference: the system, how it is read (the server name, the files glob, or the Artifact tool) and `design.url`;
- the upstream mode and the URL env var (`upstream.urlEnv`), or that no `upstream` block was written and the runbooks stay `live`;
- when the server was copied: its path (`upstream.serverFile`) and how the framework starts it. Say nothing about a copy when none was made;
- when the stack now has `api` and had not before: endpoint coverage drops on the next `/runbooks:coverage`, and why.

## 5. Commit

Commit by the `setup` policy. Ask an `ask` question only after the summary from step 4 is on screen; the question names the files and the message and does not repeat the summary.

## 6. Close

Tell the user:

- the commit outcome: the short sha, or the paths left uncommitted;
- tools missing, each with its install command (Node 18+, `npx @playwright/mcp@0.0.83 --help` to pre-fetch the MCP server when the stack has `ui`, the install command from step 2 of each framework left for later);
- what needs a restart: new `.mcp.json` servers load in a new session or through `/mcp`;
- what the design server needs before its first use: sign-in with Figma through `/mcp` for the remote server, the Figma desktop app open with its MCP server on for the desktop server, `FIGMA_API_KEY` exported in the shell that starts Claude Code for Framelink, `/login` for Claude Design.

Install nothing without asking; the only installs setup runs itself are the test libraries, after a yes in step 2. Offer `/runbooks:coverage` for a coverage baseline.

Done when the user has seen the summary before any commit question.
