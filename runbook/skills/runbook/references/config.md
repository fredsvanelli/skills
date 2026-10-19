# Config: docs/runbooks/runbook.config.json

`setup` writes this file from `${CLAUDE_PLUGIN_ROOT}/templates/runbook.config.json`. `runbook.mjs` fills missing keys with the defaults below.

| Key | Default | Meaning |
|---|---|---|
| `version` | required, `1` | config format version |
| `language` | `en` | language of runbook and report prose (`pt-BR`, `en`, ...) |
| `paths.runbooks` | `docs/runbooks` | runbook root |
| `paths.evidence` | `.runbook/evidence` | screenshots and traces, gitignored |
| `paths.e2e` | `null` | Playwright test folder for `to-test`; `null` when the project has none |
| `app.baseUrl` | `""` | the app under test; every browser mode stays inside it |
| `app.start` | `[]` | commands that start the app, shown when it is down |
| `accounts.<role>` | `{}` | `{ emailEnv, passwordEnv, loginPath }`: env var names, never values |
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

## Sources

Each `entries` or `requirements` item is one source. Every source accepts `root`, a folder relative to the project root (for a sibling repo: `"../api"`). Ids from a rooted source keep the root in their `file` (`../api/src/app/...`), and `slices` globs match that same path.

| `extractor` | Fields | Produces |
|---|---|---|
| `next-app-router` (entries) | `glob`, optional `dropSegments` (default `["[locale]", "[lang]"]`) | one `ui-route` per `page.*`, one `api-endpoint` `METHOD /path` per exported handler in `route.*`. Route groups `(x)` and slots `@x` are dropped; dynamic segments keep brackets (`/deliveries/[id]`) |
| `regex` (entries, requirements) | `glob`, `pattern` with a named group `id`, optional `method` and `title` groups, optional `flags` (default `m`), optional `kind` for entries | one item per match; `method` turns the id into `METHOD id` |
| `command` (requirements) | `command` | runs the command in `root`, reads a JSON array of `{ "id", "title" }` |

Globs support `*` (inside one folder) and `**` (any depth). `[`, `]`, `(`, `)` are literal characters.

A source whose `root` does not exist is skipped with a warning; the others still count.
