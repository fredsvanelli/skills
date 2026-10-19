# Config: docs/runbooks/runbook.config.json

`setup` writes this file from `${CLAUDE_PLUGIN_ROOT}/templates/runbook.config.json`. `runbook.mjs` fills missing keys with the defaults below.

| Key | Default | Meaning |
|---|---|---|
| `version` | required, `1` | config format version |
| `language` | `en` | language of runbook and report prose (`pt-BR`, `en`, ...) |
| `stack` | `frontend` | what the project exposes to runbooks: `frontend` (only `ui` runbooks), `backend` (only `api`), `fullstack` (both) |
| `tests.<surface>` | `{}` | the test setup of each surface the stack allows (below); required for `api`, optional for `ui` |
| `paths.runbooks` | `docs/runbooks` | runbook root |
| `paths.evidence` | `.runbook/evidence` | screenshots and traces, gitignored |
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
| `mcp.headless` / `mcp.headed` | `runbook-playwright` / `runbook-playwright-headed` | `.mcp.json` server names for the automated modes |
| `mcp.secretsFile` | `.env.local` | dotenv file passed to Playwright MCP `--secrets`; must be gitignored |

## Tests

One key per surface the stack allows, `tests.ui` and `tests.api`. A key for a surface the stack does not allow is a config error.

| Key | Meaning |
|---|---|
| `tech` | the technology of that surface (`next`, `nest`, `express`, `laravel`, `php`, ...) |
| `framework` | the test library: `playwright`, `cypress`, `jest`, `vitest`, `phpunit`, `pest`, ... `to-test` writes scripts with it |
| `dir` | the folder new scripts go in |
| `command` | runs scripts and writes a JUnit XML report. `{files}` is replaced by the script paths, `{junit}` by `.runbook/junit/<run id>.xml` |
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

## Sources

Each `entries` or `requirements` item is one source. Every source accepts `root`, a folder relative to the project root (for a sibling repo: `"../api"`). Ids from a rooted source keep the root in their `file` (`../api/src/app/...`), and `slices` globs match that same path.

| `extractor` | Fields | Produces |
|---|---|---|
| `next-app-router` (entries) | `glob`, optional `dropSegments` (default `["[locale]", "[lang]"]`) | one `ui-route` per `page.*`, one `api-endpoint` `METHOD /path` per exported handler in `route.*`. Route groups `(x)` and slots `@x` are dropped; dynamic segments keep brackets (`/deliveries/[id]`) |
| `regex` (entries, requirements) | `glob`, `pattern` with a named group `id`, optional `method` and `title` groups, optional `flags` (default `m`), optional `kind` for entries | one item per match; `method` turns the id into `METHOD id` |
| `command` (requirements) | `command` | runs the command in `root`, reads a JSON array of `{ "id", "title" }` |

Globs support `*` (inside one folder) and `**` (any depth). `[`, `]`, `(`, `)` are literal characters.

A source whose `root` does not exist is skipped with a warning; the others still count.
