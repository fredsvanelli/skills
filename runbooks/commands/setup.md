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
- An API the app calls outside its own process: an API base URL in `.env.example`. Never read a folder next to this project to learn more, even when one exists: CI checks out this repository alone, and another repository is never an `entries` source (`${CLAUDE_PLUGIN_ROOT}/docs/adr/0005-upstream-api-in-another-repo-is-a-contract.md`). An API that is a folder of this repository (a monorepo: `apps/api`, `services/api`) is an `entries` source with `root` set to that folder, and, when the stack has `api`, its tests become `tests.api` with the same `root`. Keep where the API lives for step 2.
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
- An existing config: its `stack`, and `paths.e2e`, which step 3 migrates to `tests.ui.dir`. Also what ADR 0005 moves out, for step 3: an `entries` source or a `tests.<surface>.root` outside the project root, a `slices` glob that starts with `../`, `upstream.root`, and `app.start`, `upstream.start` or `data.seedHint` commands that `cd` into a folder next to this one. `runbooks.mjs entries` prints a warning for each of the first four. A project set up before the plugin was renamed from `runbook` to `runbooks` has `docs/runbooks/runbook.config.json` instead; read that one, and step 3 migrates it.
- Slices: one slice per top-level feature folder of the UI routes, named after the folder, plus the matching API folders when the API is a folder of this repository. Without UI routes (a `backend` candidate), one slice per feature folder of the endpoints, named after it, merging the same feature across route prefixes (`admin/internal/invoices/**`, `admin/partner/invoices/**` and `v1/invoices/**` form the slice `invoices`). Endpoints above any feature folder (`GET /`, `GET /v1`, `GET /admin/me`) stay without a slice; list them in step 4.

- Role signals, always, without asking: the existing `accounts` keys, the `roles` lists of the runbooks and their `As:` lines, and whether a role enum, guard or policy file exists in this repository. Step 2 bases its "Track roles?" recommendation on them.
- Role sources, the full scan, run only after a yes to "Track roles?" in step 2, at the start of its follow-up round, and only inside this repository (never a folder next to the project, ADR 0005):
  - the code: role enums and constants, guards, middleware, policies, permission helpers, seeds and i18n role labels. A `backend` stack skips the sources that exist only in screens;
  - `upstream.schema`, when set: `securitySchemes` scopes, per-operation `security`, documented 403 responses and `x-` role extensions;
  - the signals above, read in full.

  For each role keep its name (kebab-case), where it came from (`file:line`, `contract: <what>`), the actions the sources tie to each `capability/feature`, and how sure the source is: `code`, `contract` or `guess`. Details of the registry: `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/config.md`, Roles.

Done when every key in `config.md` has a detected value or sits on the question list for step 2.

## 2. Ask the open questions

Ask with `AskUserQuestion`, each question with your recommended value. `AskUserQuestion` takes four questions per call, so ask in rounds. When detection found both screens and endpoints, ask the stack alone first, because it decides the rest. When it found only one of them, the stack is settled enough to ask together with the questions it leads to: one call with the stack, the tech, the framework and its install, and `language` when there is room; the remaining questions follow in the next round.

**Stack, always asked:** `stack` (`frontend`, `backend`, `fullstack`), recommending the detected candidate. When the answer adds `api` to an existing `ui` project, say that endpoint coverage will drop on the next `/runbooks:coverage`, because endpoints then count only through `api` runbooks (`references/coverage.md`, By surface).

**Track roles, right after the stack, for every stack:** ask "Track roles?", recommending no when the role signals of step 1 found nothing, and yes otherwise. It joins the round that asks the stack when that round has room, and otherwise opens the next round. When the existing config already has `roles.enabled` true, ask nothing and skip the scan, the `roles.json` write and `enable-roles`: running setup again leaves `roles.json` and the runbooks alone, because it would overwrite permissions set with `manage-permissions` and re-add `roles-enabled` reviews that `/runbooks:update` cleared. The only role change is step 3's addition of `accounts` keys that are not yet roles. On a no, `roles.enabled` stays false, the role questions below are skipped and nothing else about roles changes. On a yes, run the full scan, then ask in the round after it:

1. Show a table of the roles the scan found, with the `found` source of each, and ask with `AskUserQuestion`, multi-select, which are right. The user adds roles by name under "Other". `anonymous` is built in and is not listed.
2. Show the matrix the scanner deduced, one row per role and `capability/feature` key with its actions, each entry marked `code`, `contract` or `guess`. Ask whether to accept it or leave it for `/runbooks:roles:manage-permissions`. Leaving it writes every role with an empty `permissions`.

**Design reference, right after the stack (and the roles question), when it has `ui`:** ask whether the project has a design system the screens follow. Options: Figma, Claude Design, Adobe XD, Local files, recommending what detection found. The question names what detection found, or says it found nothing, and says the user can answer "none" or name another tool (Penpot, Sketch, Framer, ...) under "Other". With an existing `design`, recommend keeping it.

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

**Where the upstream API lives, right after the `ui` framework, when the stack has `ui` and the app calls an API outside its own process:** another repository (recommended when no folder of this repository holds endpoints), a folder of this repository (recommended when detection found one), or a third party. The question text says that the API's endpoints count in this project's coverage only when they are a folder of it: an API in another repository has its own runbooks install, which covers its endpoints through `api` runbooks, and the runbooks here list the operations their screens reach in `calls` (ADR 0005). Do not ask whether that repository has runbooks: the answer changes nothing here.

**Upstream mode, right after that question:** ask it only when the upstream API runs outside the app's own process (another repository, a remote URL, a third party). When it runs inside, ask nothing and write no `upstream` block, which means `live`. Options: `live`, `mocked`. Recommend, in this order:

- `mocked` when the project's tests already intercept requests (`page.route`, `cy.intercept`, `msw`);
- `live` when `upstream.baseUrl` answers now (one `curl -s -o /dev/null -w '%{http_code}' <baseUrl>`);
- `mocked` otherwise.

With an existing `upstream.mode`, recommend keeping it. The question text explains both modes in one line each (`${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/upstream.md`, Modes). When the answer is `mocked` and the API is a folder of this repository, the question text also says that its endpoints then count as covered only through `live` runbooks, because a mocked runbook covers no endpoint (`${CLAUDE_PLUGIN_ROOT}/docs/adr/0004-mocked-runbooks-never-cover-endpoints.md`), so endpoint coverage drops on the next `/runbooks:coverage`. When the project has no `tests.ui`, the question text also warns that no automated run checks the fixtures, and that only `runbooks.mjs fixtures` with a schema, or `list --affected`, notices an API change.

Then ask the keys of the block, in the next round:

- `upstream.urlEnv`, recommending the key found in `.env.example`. Required for `mocked`.
- `upstream.baseUrl`, the upstream API's URL, recommending the value detection found.
- `upstream.start`, the commands that start the API, shown when `upstream.baseUrl` does not answer. For an API in another repository, write a hint that names that repository and its command (`in cheap-courier-api: yarn dev`), never a `cd` into a folder next to this one.
- `upstream.schema`, when the API lives in another repository or is a third party: the path where this repository keeps the OpenAPI 3 JSON document the API publishes, recommending `docs/runbooks/_contract/openapi.json`. Bringing a new version of that file into this repository is the project's CI, not the plugin's (`references/upstream.md`, Another repository). When the API publishes none, say that nothing here notices an API change before a `live` run, and leave `schema` null. When the API is a folder of this repository, ask it only when detection found a local OpenAPI 3 JSON file.
- `upstream.redactHeaders`, only when detection left it open. The user may skip it.

Keys not asked keep their defaults from `config.md`, Upstream.

**Then, only for keys detection could not settle:**

- `language` for runbook prose.
- The `commits` policy for `runbooks` and `setup`, one question each, with three options: Ask before committing (`ask`, recommended), Commit automatically (`auto`) and Never commit (`never`: the command neither commits nor asks).
- When the stack has `ui`: `app.baseUrl` and `app.start`; `accounts` (role names and the env var names holding each email and password; ask for names only); `mcp.secretsFile`, when it is not `.env.local`; whether to add the two Playwright MCP servers to `.mcp.json`.

A `backend` stack skips every browser question.

## 3. Write

| Target | Source |
|---|---|
| `docs/runbooks/runbooks.config.json` | `${CLAUDE_PLUGIN_ROOT}/templates/runbooks.config.json` filled with steps 1 and 2 |
| `docs/runbooks/README.md` | `${CLAUDE_PLUGIN_ROOT}/templates/readme.md` |
| `docs/runbooks/_runs/.gitignore` | two lines, `*` and `!.gitignore`: the folder is tracked, the reports in it stay local |
| `docs/runbooks/_coverage/.gitignore` | two lines, `*` and `!.gitignore`: the folder is tracked, the reports in it stay local |
| `.gitignore` | add `.runbooks/` when missing |
| agents block | `${CLAUDE_PLUGIN_ROOT}/templates/agents-block.md`, with `${CLAUDE_PLUGIN_ROOT}/templates/api-practices.md` filled in when the stack has `api` |
| `docs/runbooks/roles.json` (only when the config did not already have `roles.enabled` true; with tracking already on, only the additions of the Roles bullet) | the roles the user confirmed in step 2, with `description`, `found`, `permissions` and `origins`, `"version": 1` (`config.md`, Roles) |
| `.mcp.json` (when approved and the stack has `ui`) | `${CLAUDE_PLUGIN_ROOT}/templates/mcp-servers.json`, plus the design server from step 2 (`${CLAUDE_PLUGIN_ROOT}/templates/design-servers.json` for Figma) |

- Rename from `runbook`: when step 1 found `docs/runbooks/runbook.config.json`, move it with `git mv` to `runbooks.config.json`. In the config, `paths.evidence` `.runbook/evidence` becomes `.runbooks/evidence`, and `mcp.headless`/`mcp.headed` `runbook-playwright`/`runbook-playwright-headed` become `runbooks-playwright`/`runbooks-playwright-headed`. Rename those two servers in `.mcp.json` too, replace `.runbook/` with `.runbooks/` in the root `.gitignore`, replace the `<!-- runbook:start -->` and `<!-- runbook:end -->` markers with the new ones, and replace `runbook@<marketplace>` with `runbooks@<marketplace>` in `enabledPlugins`. Move a local `.runbook/` folder to `.runbooks/`.
- Config: write `stack` and one `tests.<surface>` block per surface that has a framework. Drop `paths.e2e`; its value moves to `tests.ui.dir` when there is no `tests.ui` yet. Keep the existing `viewports`: `create` writes them. Write `design` from step 2, or keep the existing one when the user kept it.
- Upstream: when step 2 asked the mode, write the `upstream` block with the answers and leave the other keys out so they keep their defaults (`config.md`, Upstream). Keep the existing block's keys that the user kept. Drop `upstream.root`, which no command reads any more. In a `backend` stack the block is a config error, so write none.
- Another repository (ADR 0005): when step 1 found an `entries` source whose `root` is outside the project, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" move-to-calls --source <index>` while that folder is still there, or `move-to-calls` without `--source` once the source is gone from the config. It is a dry run: show its table, the entry coverage before and after, and the orphans it leaves for `/runbooks:update`, and ask whether to apply. On a yes, remove the source and the `slices` globs that start with `../` from the config, run the same command with `--write` (before removing the source when it used `--source`), and add the runbooks it lists to the write list. Show `app.start`, `upstream.start` and `data.seedHint` commands that `cd` into a folder next to this one, and offer to rewrite them as `upstream.start` hints or drop them. A `tests.<surface>.root` outside the project stays for now and warns; say that it becomes a config error in runbooks 2.0 and that a `fullstack` stack spans one repository.
- Upstream server: copy only when `tests.ui` exists and some runbook can be mocked, that is when the default `upstream.mode` is `mocked` or the user says some runbooks will be mocked. Ask that only when the default is `live`. A live-only project gets no copy and `upstream.serverFile` stays null. Then copy `${CLAUDE_PLUGIN_ROOT}/scripts/upstream-server.mjs` to `<tests.ui.dir>/runbooks-upstream.mjs` and write that path to `upstream.serverFile`, so CI runs mocked scripts without the plugin. When the file exists, show its diff first; running `setup` again is how the copy is refreshed. Do not edit the framework config. Show how the framework starts the copy, with the app's `upstream.urlEnv` set to `http://127.0.0.1:<upstream.port>`:
  - Playwright: a `webServer` entry whose `command` is `node <tests.ui.dir>/runbooks-upstream.mjs --fixtures <upstream.fixtures> --port <upstream.port>`, whose `url` is `http://127.0.0.1:<upstream.port>/__runbooks/state`, and with `reuseExistingServer: !process.env.CI`, because `/runbooks:run` and `/runbooks:to-test` may already have started the server on that port.
  - Cypress: a child process started in `setupNodeEvents` with the same command.
  - When `upstream.baseUrl` is set, add `--mode live --target <upstream.baseUrl>` to the command, so tests that never select reach the live API through the server. Add `--redact <upstream.redactHeaders>` when the list is not empty. The server prints `runbooks-upstream listening on http://127.0.0.1:<port>`.
  - The server holds one state for every client, so every test suite whose app points at it runs with one worker, in CI too: Playwright `workers: 1` for that project or job, while Cypress already runs specs one at a time. Mocked scripts post `{ runbook, mode: 'mocked', step }` in `beforeEach` and `{ runbook: null, mode: 'live' }` in `afterAll`; live `ui` scripts post nothing (`references/upstream.md`, "Scripts").
- Agents block: when one of `AGENTS.md` and `CLAUDE.md` is a symlink to the other, write once to the real file. Otherwise prefer `AGENTS.md` when it exists, else `CLAUDE.md`. Replace the text between `<!-- runbooks:start -->` and `<!-- runbooks:end -->` when the markers exist; otherwise append the block at the end of the file.
- API scripts checklist: when the stack has `api`, replace the `<!-- api-scripts: ... -->` line of the block with `api-practices.md`, every placeholder filled with what this project does, citing the helper and its path, from the tests read in step 1. Keep its Roles bullet only when role tracking is on. When the project has no `api` tests yet, fill it with the usual practice of the chosen `tech` and `framework` and say so in the summary. Without `api`, delete the line. Cover how scripts are written only; the project's own conventions for backend code are not this block's business.
- Roles, only when the user said yes in this run and the config did not already have `roles.enabled` true, write in this order and stop at the first failure. With tracking already on, do none of this except the `accounts` rule of item 1, as additions to `roles.json` shown in its diff; `enable-roles` does not run:
  1. `roles.json` and the config with `roles.enabled` true. Each role gets the `found` sources and the `origins` of the matrix entries it kept. Make every key of `accounts` a registered role: a key that is not one is added to `roles.json` with `found: ["accounts"]` and an empty `permissions`, because the loader rejects an `accounts` key that is not a role. `accounts.anonymous` is removed from the config, because `anonymous` has no session; list it in the summary of step 4.
  2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" enable-roles` as a dry run. It refuses while tracking is off, which is why the config comes first. Show what it would do: the runbooks that get `roles: all` (the old `roles` list is replaced) and a `review` entry with `roles-enabled`. Ask whether to apply.
  3. On a yes, run it again with `--write` and add the changed runbooks to the write list. The user then runs `/runbooks:update` on each to write the per-role Expected lines (`format.md`, Roles). On a no, tracking stays on and the runbooks stay as they are, which `list` reports as problems until `enable-roles --write` runs.

  The config and `roles.json` go into the `setup` commit, the runbook edits into the `runbooks` commit (`commits.md`).
- Test command: when `tests.<surface>.command` is set and the framework is installed, run it once with `{files}` set to one existing test of that surface (or an empty run when there is none) and `{junit}` set to `.runbooks/junit/setup.xml`, and confirm the file appears. Fix the command until it does.
- Design server: write the chosen template to `mcpServers` under the name `figma`, or the other tool's server under its name, and set `design.mcp` to that name. For Framelink, replace `<version>` with what `npm view figma-developer-mcp version` prints. A token stays in the user's environment: `.mcp.json` holds only `${NAME}`.
- `.mcp.json`: merge the two servers into `mcpServers`, keeping every existing server. Replace `<mcp.secretsFile>` and `<paths.evidence>`. Confirm the secrets file is ignored with `git check-ignore -q <file>`; when it is not, stop and tell the user, because the MCP server would read a tracked file.
- Report folders: when `git ls-files <paths.runbooks>/_runs <paths.runbooks>/_coverage` lists anything besides the two `.gitignore` files (reports, `.gitkeep` or `_runs/output.*` from an older setup), show the list and offer `git rm -r --cached --quiet -- <files>`. The files stay on disk; the removal goes into the setup commit.
- Summary files: when `<paths.runbooks>/runs.json`, `runs.html`, `coverage.json` or `coverage.html` exist, delete them from disk, and remove the lines `/<paths.runbooks>/runs.*` and `/<paths.runbooks>/coverage.*` from the root `.gitignore`. Git ignores the files, so nothing is staged for them; the `.gitignore` change goes into the setup commit.
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
- when the stack now has `api` and had not before: endpoint coverage drops on the next `/runbooks:coverage`, and why;
- when the user turned role tracking on: an `accounts.anonymous` entry removed, if any; the roles registered and the matrix entries marked `guess`, how many runbooks got `roles: all` and a `review` with `roles-enabled`, and that `/runbooks:list --review` lists them; offer it. Say that `/runbooks:update <id>` writes the per-role lines and clears the review;
- when step 3 moved ids to `calls`: the runbooks changed, the entry coverage before and after from `move-to-calls`, and that the API's own install now owns the coverage of its endpoints.

## 5. Commit

Commit by the `setup` policy, and the runbooks changed by `enable-roles` or `move-to-calls` by the `runbooks` policy. Ask an `ask` question only after the summary from step 4 is on screen; the question names the files and the message and does not repeat the summary.

## 6. Close

Tell the user:

- the commit outcome: the short sha, or the paths left uncommitted;
- tools missing, each with its install command (Node 18+, `npx @playwright/mcp@0.0.83 --help` to pre-fetch the MCP server when the stack has `ui`, the install command from step 2 of each framework left for later);
- what needs a restart: new `.mcp.json` servers load in a new session or through `/mcp`;
- what the design server needs before its first use: sign-in with Figma through `/mcp` for the remote server, the Figma desktop app open with its MCP server on for the desktop server, `FIGMA_API_KEY` exported in the shell that starts Claude Code for Framelink, `/login` for Claude Design;
- when the config sets `upstream.schema` for an API in another repository: the two CI jobs the project needs and the plugin does not write, one that brings each new version of the API's OpenAPI document into `upstream.schema` and opens a pull request, and one that runs `runbooks.mjs contract --strict` (`${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/upstream.md`, Contract).

Install nothing without asking; the only installs setup runs itself are the test libraries, after a yes in step 2. Offer `/runbooks:coverage` for a coverage baseline.

Done when the user has seen the summary before any commit question.
