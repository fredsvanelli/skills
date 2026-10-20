# Config: docs/runbooks/runbooks.config.json

`setup` writes this file from `${CLAUDE_PLUGIN_ROOT}/templates/runbooks.config.json`. `runbooks.mjs` fills missing keys with the defaults below.

| Key | Default | Meaning |
|---|---|---|
| `version` | required, `1` | config format version |
| `language` | `en` | language of runbook and report prose (`pt-BR`, `en`, ...) |
| `stack` | `frontend` | what the project exposes to runbooks: `frontend` (only `ui` runbooks), `backend` (only `api`), `fullstack` (both) |
| `tests.<surface>` | `{}` | the test setup of each surface the stack allows (below); required for `api`, optional for `ui` |
| `paths.runbooks` | `docs/runbooks` | runbook root |
| `paths.evidence` | `.runbooks/evidence` | screenshots and traces, gitignored |
| `paths.e2e` | `null` | replaced by `tests.ui.dir`. An older config that still has it reads as `tests.ui: { framework: "playwright", dir: <paths.e2e> }`; `setup` migrates it |
| `app.baseUrl` | `""` | the app under test; every browser mode stays inside it. `ui` only |
| `app.start` | `[]` | commands that start the app, shown when it is down |
| `accounts.<role>` | `{}` | `{ emailEnv, passwordEnv, loginPath }`: env var names, never values. `ui` only: an `api` script authenticates the way the agents block says |
| `uiText` | `[]` | files holding UI strings (i18n messages), default locale first |
| `data.seedHint` | `""` | the project's own command for test data, cited in preconditions |
| `entries` | `[]` | entry point sources (below) |
| `requirements` | `[]` | requirement sources (below) |
| `slices` | `{}` | `{ "<capability>": ["<glob>", ...] }`: which files belong to each capability |
| `tickets.fetch` | `""` | command printing a ticket's text; `{id}` is replaced by the ticket id |
| `git.base` | `main` | base for `--affected` and diffs |
| `git.protected` | `["main"]` | branches where `auto` commits fall back to `ask` |
| `git.messageFormat` | `docs(runbooks): {summary}` | commit message; `{summary}` is replaced |
| `commits.runbooks/setup` | `ask/ask` | commit policy per artifact (`never`, `ask`, `auto`) |
| `mcp.headless` / `mcp.headed` | `runbooks-playwright` / `runbooks-playwright-headed` | `.mcp.json` server names for the automated modes |
| `mcp.secretsFile` | `.env.local` | dotenv file passed to Playwright MCP `--secrets`; must be gitignored |
| `viewports.<name>` | `{}` | `{ width, height }` in CSS pixels: a screen size `ui` runbooks cite in their `viewports` (below) |
| `design` | `null` | the design reference `run` compares `ui` steps with (below); `null` means the project has none. Only in a stack with `ui` |
| `upstream` | absent | how `ui` runbooks reach their upstream API (below); absent means `live`. Only in a stack with `ui` |

## Tests

One key per surface the stack allows, `tests.ui` and `tests.api`. A key for a surface the stack does not allow is a config error.

| Key | Meaning |
|---|---|
| `tech` | the technology of that surface (`next`, `nest`, `express`, `laravel`, `php`, ...) |
| `framework` | the test library: `playwright`, `cypress`, `jest`, `vitest`, `phpunit`, `pest`, ... `to-test` writes scripts with it |
| `dir` | the folder new scripts go in |
| `command` | runs scripts and writes a JUnit XML report. `{files}` is replaced by the script paths, `{junit}` by `.runbooks/junit/<run id>.xml` |
| `root` | optional: the folder the command runs in, relative to the project root (`"../api"`), as in `entries` sources |
| `baseUrl` | optional, `api` only: set when the scripts call a running server (Playwright `request`, `cy.request`, supertest against a URL); `run` then checks it answers |

```json
"stack": "fullstack",
"tests": {
  "ui":  { "tech": "next", "framework": "playwright", "dir": "e2e",
           "command": "PLAYWRIGHT_JUNIT_OUTPUT_NAME={junit} npx playwright test {files} --reporter=junit" },
  "api": { "tech": "laravel", "framework": "phpunit", "dir": "tests/Feature/Runbooks", "root": "../api",
           "command": "php artisan test {files} --log-junit {junit}" }
}
```

JUnit flags by framework: Jest `--reporters=default --reporters=jest-junit` with `JEST_JUNIT_OUTPUT_FILE={junit}` (needs `jest-junit`), Vitest `--reporter=junit --outputFile={junit}`, PHPUnit and Pest `--log-junit {junit}`, Playwright `--reporter=junit` with `PLAYWRIGHT_JUNIT_OUTPUT_NAME={junit}`, Cypress `--reporter junit --reporter-options mochaFile={junit}`.

Endpoint sources: the `next-app-router` extractor marks route handlers `api-endpoint`. A `regex` source for endpoints (`routes/api.php`, Nest controllers) sets `"kind": "api-endpoint"`, so coverage can tell endpoints from screens.

## Viewports

Each name is a screen size that `ui` runbooks run at. `create` adds one when the user picks a size the config lacks; `setup` keeps the existing ones. Names are kebab-case; width and height are positive integers.

```json
"viewports": {
  "desktop": { "width": 1440, "height": 900 },
  "tablet":  { "width": 768,  "height": 1024 },
  "mobile":  { "width": 390,  "height": 844 }
}
```

Put each width inside one range of the project's breakpoints, so the page gets the layout of that range. The project declares its breakpoints in one of these places:

- Tailwind v4: `--breakpoint-*` in `@theme`. Defaults: `sm` 640, `md` 768, `lg` 1024, `xl` 1280, `2xl` 1536.
- Tailwind v3: `theme.screens` in `tailwind.config.*`, with the same defaults.
- Bootstrap: `$grid-breakpoints`. Defaults: 576, 768, 992, 1200, 1400.
- MUI: `theme.breakpoints.values`. Defaults: 600, 900, 1200, 1536.
- Plain CSS and JS: `@media` rules with `min-width` or `max-width`, and `matchMedia` or `useMediaQuery` calls.

The sizes in the example fit the Tailwind defaults: 390 is below `sm`, 768 is where `md` starts, and 1440 falls between `xl` and `2xl`.

## Design

`setup` writes it when the user names a design reference. `create` and `update` link a runbook's screens to it (`format.md`, the `design` key), and `run` compares each linked step with its design.

| Key | Meaning |
|---|---|
| `system` | `figma`, `claude-design`, `adobe-xd`, `files` or `other` |
| `name` | for `other`: the tool's name (Penpot, Sketch, Framer, ...) |
| `mcp` | the `.mcp.json` server that reads the designs. Required for `figma` and `other` unless `files` is set |
| `files` | a glob of designs exported into the repository (PNG, JPG, WebP, SVG, PDF). Required for `files` and `adobe-xd` |
| `url` | optional: the design file or project the runbooks' frames come from (a Figma file link, a Claude Design link). `create` searches there first |

```json
"design": { "system": "figma", "mcp": "figma", "url": "https://www.figma.com/design/AbC123/Billing" }
```

How each system is read, and what a runbook cites:

| `system` | Read through | A reference in a runbook |
|---|---|---|
| `figma` | the `mcp` server, or the exported files in `files` | a frame link with its `node-id` (`https://www.figma.com/design/AbC123/Billing?node-id=12-34`), or a file path |
| `claude-design` | the Artifact tool, with Claude Code signed in to claude.ai. No server to add | a claude.ai link to a design |
| `adobe-xd` | artboards exported as PNG into `files`. Adobe XD has no MCP server | a file path |
| `files` | the files in `files`, read as images or PDF | a file path |
| `other` | the `mcp` server the user added, or the files in `files` | what that server takes (a link or an id), or a file path |

The Figma servers `setup` offers live in `${CLAUDE_PLUGIN_ROOT}/templates/design-servers.json`, and each one is written to `.mcp.json` under the name `figma`:

| Template | Server | Needs |
|---|---|---|
| `figma-remote` | Figma's remote MCP server | sign-in with Figma through `/mcp`, once |
| `figma-desktop` | Figma's desktop MCP server, served by the Figma desktop app | the app open, with its MCP server turned on in Dev Mode |
| `figma-framelink` | the `figma-developer-mcp` package, pinned to the version `npm view figma-developer-mcp version` prints | a Figma personal access token in the env var `FIGMA_API_KEY` of the shell that starts Claude Code. `.mcp.json` holds only `${FIGMA_API_KEY}`, never the token |

## Upstream

`setup` writes it when the stack has `ui` and the upstream API is not served by the app's own process. A config without it behaves as `live`. The block is a config error in a `backend` stack. The modes, the server and the fixtures: `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/upstream.md`.

| Key | Default | Meaning |
|---|---|---|
| `mode` | `live` | the project default: `live` or `mocked`. A runbook overrides it with `upstream:` in its frontmatter |
| `baseUrl` | `""` | the upstream API's URL. `live` and `record` proxy to it, and `run` checks it answers before a live runbook |
| `start` | `[]` | commands that start the upstream API, shown when `baseUrl` does not answer |
| `root` | `null` | the folder of the upstream API's repo, relative to the project root (`"../api"`). In a `fullstack` stack whose `tests.api.root` is that repo, it takes the same value |
| `urlEnv` | `""` | the env var the app reads the API URL from (`NEXT_PUBLIC_API_URL`). The app starts with it set to the upstream server. Required when `mode` is `mocked` |
| `port` | `4010` | the upstream server's port, an integer from 1 to 65535 |
| `fixtures` | `<paths.runbooks>/_fixtures` | the folder of the fixtures |
| `schema` | `null` | a local OpenAPI 3 JSON file (`.json`). `run` and `fixtures` check each fixture against it. YAML files and URLs are not read |
| `redactHeaders` | `[]` | header names the recorder drops, besides `set-cookie`, `authorization` and `cookie`. Case does not matter |
| `tokenEnv` | `""` | env var holding a service token, for an upstream API without password login |
| `serverFile` | `null` | where `setup` copied the upstream server in the project (`<tests.ui.dir>/runbooks-upstream.mjs`) |

```json
"upstream": {
  "mode": "mocked",
  "baseUrl": "https://api.example.com/v1",
  "urlEnv": "NEXT_PUBLIC_API_URL",
  "schema": "docs/openapi.json"
}
```

Errors the loader raises:

- `upstream must be an object with a "mode"`
- `upstream applies only to ui runbooks, and a <stack> stack has none`
- `upstream.mode must be one of live, mocked`
- `upstream.urlEnv is required when upstream.mode is mocked`
- `upstream.port must be an integer from 1 to 65535`
- `upstream.schema must be a JSON file (a local OpenAPI 3 .json path)`
- `upstream.redactHeaders must be a list of header names`

## Sources

Each `entries` or `requirements` item is one source. Every source accepts `root`, a folder relative to the project root (for a sibling repo: `"../api"`). Ids from a rooted source keep the root in their `file` (`../api/src/app/...`), and `slices` globs match that same path.

| `extractor` | Fields | Produces |
|---|---|---|
| `next-app-router` (entries) | `glob`, optional `dropSegments` (default `["[locale]", "[lang]"]`) | one `ui-route` per `page.*`, one `api-endpoint` `METHOD /path` per exported handler in `route.*`. Route groups `(x)` and slots `@x` are dropped; dynamic segments keep brackets (`/deliveries/[id]`) |
| `regex` (entries, requirements) | `glob`, `pattern` with a named group `id`, optional `method` and `title` groups, optional `flags` (default `m`), optional `kind` for entries | one item per match; `method` turns the id into `METHOD id` |
| `command` (requirements) | `command` | runs the command in `root`, reads a JSON array of `{ "id", "title" }` |

Globs support `*` (inside one folder) and `**` (any depth). `[`, `]`, `(`, `)` are literal characters.

A source whose `root` does not exist is skipped with a warning; the others still count.
