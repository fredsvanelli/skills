# Config: docs/runbooks/runbooks.config.json

`setup` writes this file from `${RUNBOOKS_PLUGIN_ROOT}/templates/runbooks.config.json`. `runbooks.mjs` fills missing keys with the defaults below.

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
| `roles.enabled` | `false` | whether the project tracks roles. `setup` asks, and `settings roles` turns it on. When true, `<paths.runbooks>/roles.json` must exist and every key of `accounts` must be a registered role. Turning it off again is not supported. With it false or missing, nothing about roles applies (below) |
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
| `mcp.headless` / `mcp.headed` | `runbooks-playwright` / `runbooks-playwright-headed` | active-host MCP server names (`.mcp.json` on Claude, `.codex/config.toml` on Codex) for the automated modes |
| `mcp.secretsFile` | `.env.local` | dotenv file passed to Playwright MCP `--secrets`; must be gitignored |
| `viewports.<name>` | `{}` | `{ width, height }` in CSS pixels: a screen size `ui` runbooks cite in their `viewports` (below) |
| `design` | `null` | the design reference `run` compares `ui` steps with (below); `null` means the project has none. Only in a stack with `ui` |
| `upstream` | absent | how `ui` runbooks reach their upstream API (below); absent means `live`. Only in a stack with `ui` |
| `staleDays` | `30` | days after `last_run.oldest` (the oldest run a cell cites), or after `last_run.date` when `oldest` is not set, that make an `active` or `draft` runbook stale in `/runbooks:ui`; a positive integer |

## Tests

One key per surface the stack allows, `tests.ui` and `tests.api`. A key for a surface the stack does not allow is a config error.

| Key | Meaning |
|---|---|
| `tech` | the technology of that surface (`next`, `nest`, `express`, `laravel`, `php`, ...) |
| `framework` | the test library: `playwright`, `cypress`, `jest`, `vitest`, `phpunit`, `pest`, ... `to-test` writes scripts with it |
| `dir` | the folder new scripts go in |
| `command` | runs scripts and writes a JUnit XML report. `{files}` is replaced by the script paths, `{junit}` by `.runbooks/junit/<run id>.xml` |
| `root` | optional: the folder the command runs in, relative to the project root (`"apps/api"`), as in `entries` sources. `dir` is relative to it. `tests.api.root` stays inside the project: a `root` outside it warns, and from runbooks 2.0 it is a config error (`${RUNBOOKS_PLUGIN_ROOT}/docs/adr/0005-upstream-api-in-another-repo-is-a-contract.md`). `tests.ui.root` may point to a UI tests repository (`"../project-001-e2e"`); a runbook's `scripts` then start with that path (`${RUNBOOKS_PLUGIN_ROOT}/docs/adr/0007-ui-tests-may-live-in-another-repo.md`) |
| `baseUrl` | optional, `api` only: set when the scripts call a running server (Playwright `request`, `cy.request`, supertest against a URL); `run` then checks it answers |

```json
"stack": "fullstack",
"tests": {
  "ui":  { "tech": "next", "framework": "playwright", "dir": "e2e",
           "command": "PLAYWRIGHT_JUNIT_OUTPUT_NAME={junit} npx playwright test {files} --reporter=junit" },
  "api": { "tech": "laravel", "framework": "phpunit", "dir": "tests/Feature/Runbooks", "root": "apps/api",
           "command": "php artisan test {files} --log-junit {junit}" }
}
```

JUnit flags by framework: Jest `--reporters=default --reporters=jest-junit` with `JEST_JUNIT_OUTPUT_FILE={junit}` (needs `jest-junit`), Vitest `--reporter=junit --outputFile={junit}`, PHPUnit and Pest `--log-junit {junit}`, Playwright `--reporter=junit` with `PLAYWRIGHT_JUNIT_OUTPUT_NAME={junit}`, Cypress `--reporter junit --reporter-options mochaFile={junit}`.

Endpoint sources: the `next-app-router` extractor marks route handlers `api-endpoint`. A `regex` source for endpoints (`routes/api.php`, Nest controllers) sets `"kind": "api-endpoint"`, so coverage can tell endpoints from screens.

## Roles

`roles.enabled` is the switch. With it true, the project keeps a registry of its roles at `<paths.runbooks>/roles.json`, committed by the `runbooks` commit policy, with the runbook edits, while config changes stay in the `setup` commit. With it false or missing, `roles: [admin]` in a runbook keeps its meaning (the account roles the steps log in as), `roles: all` and `review` are problems, and no command or script reads the registry. The runbook side of roles: `format.md`, "Roles".

```json
{
  "version": 1,
  "actions": ["approve", "export"],
  "roles": {
    "anonymous": { "description": "No session", "permissions": {} },
    "editor": {
      "description": "Edits invoices and clients",
      "found": ["src/auth/roles.ts:12", "contract: scope invoices:write"],
      "permissions": { "billing/invoices": ["view", "create", "edit"], "billing/clients": ["view", "create", "edit"] },
      "origins": { "billing/clients": "guess" }
    },
    "manager": {
      "description": "Billing manager",
      "inherits": ["editor"],
      "found": ["user"],
      "permissions": { "billing/invoices": ["view", "create", "edit", "approve"] }
    }
  }
}
```

| Key | Meaning |
|---|---|
| `version` | required: `1`, or `2` when the file has `contexts` |
| `actions` | the actions the project adds to the four fixed ones. The registry's action list is the fixed four followed by these. Identifiers are English and the UI shows them as they are |
| `roles.<name>` | one entry per role. Names are kebab-case (`^[a-z0-9][a-z0-9-]*$`) |
| `description` | one line about the role |
| `inherits` | the parent roles. Missing means none |
| `found` | where the role came from: `file:line`, `contract: <what>`, a document path such as `docs/access.pdf:p3`, or `user`. `/runbooks:ui` shows it |
| `contexts` | optional: the questions about the record that change what a role may do on some keys ("Contexts" below). Needs `"version": 2` |
| `permissions` | the matrix: each key maps to a list of actions, or, on a key of a context, to a map from case to list ("Contexts" below) |
| `origins` | per matrix key, how the scanner got it: `code`, `contract` or `guess` |

Base actions are `view`, `create`, `edit` and `delete`. They are fixed and need no entry in `actions`. An action in a role's permissions that is not in the action list is an error.

**Keys.** A matrix key is `<capability>/<feature>` or `<capability>/*`, with the same names as runbook frontmatter. A key that matches no runbook's `capability/feature` and no slice gives a warning, to catch typos.

**Lookup.** For a runbook, the role's entry for `<capability>/<feature>` wins over `<capability>/*`. A runbook with no `feature` uses `<capability>/*`. No entry means no access. On a key of a context, the lookup also takes the case ("Contexts" below).

**Inheritance and override.** Roles can be independent or cumulative. The effective matrix of a role is the union of its parents' effective entries, plus its own. An own entry for a key replaces the inherited entry for that same key, so a manager can lose `delete` that its parent has. When two parents give the same key, their actions are joined. A cycle in `inherits` is an error.

**Contexts.** A context is a question about the record that changes what a role may do on some keys: how the user relates to the client a record belongs to, for example. A case is one answer to it. The same `manager` login can edit one client and only view another. One list of actions per key cannot express that, and a context can. `/runbooks:contexts:create`, `/runbooks:contexts:update` and `/runbooks:contexts:delete` create, edit and delete contexts.

```json
{
  "version": 2,
  "actions": [],
  "contexts": {
    "client-access": {
      "description": "How the user relates to the client the record belongs to",
      "keys": ["clients/*", "billing/invoices"],
      "cases": {
        "vip-team": "VIP client, the user is on its team",
        "vip-outside": "VIP client, the user is not on its team",
        "regular": "client that is not VIP"
      }
    }
  },
  "roles": {
    "viewer": { "permissions": { "clients/*": ["view"] } },
    "manager": {
      "permissions": {
        "clients/*": {
          "vip-team": ["view", "create", "edit", "delete"],
          "vip-outside": ["view"],
          "regular": ["view", "create", "edit"]
        }
      }
    }
  }
}
```

| Key | Meaning |
|---|---|
| `contexts.<name>` | one entry per context. Names are kebab-case |
| `description` | one line: the question about the record |
| `keys` | the matrix keys the context reaches, with the syntax of "Keys" above |
| `cases` | a map from case name to one sentence that says which record the case describes. Case names are kebab-case and unique across every context, so a case alone names it in role lines, fixture folders and test names |

- A file with `contexts` has `"version": 2`. The loader reads versions 1 and 2, and a file at `version: 1` with `contexts` is an error. A file with no `contexts` can stay at version 1.
- A matrix key belongs to a context when the context lists it, or when the key is `<capability>/<feature>` and the context lists `<capability>/*`. A key that belongs to two contexts is an error.
- On a key of a context, a role's entry is either a list, which gives the same actions in every case, or a map from case to list. A case the map leaves out is no access in that case. A map on a key of no context, or with a case its context does not have, is an error.
- Inheritance works per case. A parent's list counts as the same list in every case, and two parents join their actions case by case. An own entry still replaces the inherited entry for the whole key and all its cases, so an own map that leaves out a case takes that case away. `runbooks.mjs roles <name>` prints the effective matrix with one row per key and case.
- `origins` stays per key, also on a key of a context.
- A runbook whose `capability/feature` matches a key of a context runs once per case, and its text states what each role gets in each case (`format.md`, "Contexts and cases").

**`found` and `origins`.** `found` is per role and `origins` is per key. A key the user typed has no `origins` entry. `/runbooks:permissions:manage` removes a key's entry when the user edits that key, and `/runbooks:roles:generate` gives each key it adds or changes the proposal's origin: `guess` for a key it deduced, none for a key the source states. `roles` listings and `/runbooks:ui` flag the keys still marked `guess`. An `origins` key that is not in `permissions` is an error.

**`anonymous`.** It is always present, even when the file omits it. It cannot be deleted, renamed or given an account, and it inherits nothing.

**Relation to `accounts`.** `accounts.<role>` holds the login of a role, as env var names. Every key of `accounts` must be a registered role, and `accounts.anonymous` is an error. A registered role without an `accounts` entry is valid: a `ui` run gives it `no-account`. The registry never holds a credential value.

**Generating from a document.** `/runbooks:roles:generate` reads a document in any format, writes a proposal as JSON and merges it with `runbooks.mjs merge-roles`. The merge adds roles, contexts, cases, project actions and keys, and replaces the own entry of each key the proposal gives. A role, context or key the proposal leaves out stays as it is, and a key goes away only through the proposal's `remove` list. It never changes the parents of a registered role and never deletes a role, a context or a case: those stay with their own commands.

Permission history comes from `git log` of `roles.json`. The plugin writes no history of its own.

Errors the loader raises, each prefixed with the file path:

- `unsupported version <n>, expected 1 or 2`
- `contexts need version 2`
- `role "<name>" must be kebab-case`
- `<role> inherits "<parent>", which is not a registered role`
- `anonymous inherits nothing`
- `inheritance cycle: a -> b -> a`
- `<role>: key "<key>" must be <capability>/<feature> or <capability>/*`
- `<role> "<key>": action "<action>" is not in actions`, and `<role> "<key>" in <case>: action "<action>" is not in actions` inside a map
- `context "<name>" must be kebab-case`
- `context "<name>": keys must be a list of matrix keys`
- `context "<name>": key "<key>" must be <capability>/<feature> or <capability>/*`
- `context "<name>": cases must map each case to a description`
- `case "<name>" must be kebab-case`
- `case "<name>" appears in contexts <a> and <b>`
- `key "<key>" belongs to contexts <a> and <b>`
- `<role> "<key>": a map of cases needs a key that belongs to a context`
- `<role> "<key>": case "<case>" is not a case of <context>`
- `accounts.<role> is not a registered role`
- `accounts.anonymous is not allowed, because anonymous has no session`

Warnings, which leave the registry usable:

- `roles.json: <role> "<key>" matches no runbook or slice`
- `roles.json: context <name> key "<key>" matches no runbook or slice`
- `roles.json: context <name> has fewer than two cases`

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
| `mcp` | the active-host MCP server that reads the designs. Required for `figma` and `other` unless `files` is set |
| `files` | a glob of designs exported into the repository (PNG, JPG, WebP, SVG, PDF). Required for `files` and `adobe-xd` |
| `url` | optional: the design file or project the runbooks' frames come from (a Figma file link, a Claude Design link). `create` searches there first |

```json
"design": { "system": "figma", "mcp": "figma", "url": "https://www.figma.com/design/AbC123/Billing" }
```

How each system is read, and what a runbook cites:

| `system` | Read through | A reference in a runbook |
|---|---|---|
| `figma` | the `mcp` server, or the exported files in `files` | a frame link with its `node-id` (`https://www.figma.com/design/AbC123/Billing?node-id=12-34`), or a file path |
| `claude-design` | the Artifact tool when available and signed in; otherwise use an exported file. No server to add | a claude.ai link to a design |
| `adobe-xd` | artboards exported as PNG into `files`. Adobe XD has no MCP server | a file path |
| `files` | the files in `files`, read as images or PDF | a file path |
| `other` | the `mcp` server the user added, or the files in `files` | what that server takes (a link or an id), or a file path |

The Figma servers `setup` offers live in `${RUNBOOKS_PLUGIN_ROOT}/templates/design-servers.json`, and each one is merged under the name `figma` into the active host's MCP configuration (see `runtime.md` for JSON-to-TOML translation):

| Template | Server | Needs |
|---|---|---|
| `figma-remote` | Figma's remote MCP server | sign-in with Figma through `/mcp`, once |
| `figma-desktop` | Figma's desktop MCP server, served by the Figma desktop app | the app open, with its MCP server turned on in Dev Mode |
| `figma-framelink` | the `figma-developer-mcp` package, pinned to the version `npm view figma-developer-mcp version` prints | a Figma personal access token in the env var `FIGMA_API_KEY` of the shell that starts Claude Code. `.mcp.json` holds only `${FIGMA_API_KEY}`, never the token |

## Upstream

`setup` writes it when the stack has `ui` and the upstream API is not served by the app's own process. A config without it behaves as `live`. The block is a config error in a `backend` stack. The modes, the server and the fixtures: `${RUNBOOKS_PLUGIN_ROOT}/skills/runbooks/references/upstream.md`.

| Key | Default | Meaning |
|---|---|---|
| `mode` | `live` | the project default: `live` or `mocked`. A runbook overrides it with `upstream:` in its frontmatter |
| `baseUrl` | `""` | the upstream API's URL. `live` and `record` proxy to it, and `run` checks it answers before a live runbook |
| `start` | `[]` | commands that start the upstream API, shown when `baseUrl` does not answer. For an API in another repository, a hint that names that repository and its command (`in cheap-courier-api: yarn dev`) |
| `urlEnv` | `""` | the env var the app reads the API URL from (`NEXT_PUBLIC_API_URL`). The app starts with it set to the upstream server. Required when `mode` is `mocked` |
| `port` | `4010` | the upstream server's port, an integer from 1 to 65535 |
| `fixtures` | `<paths.runbooks>/_fixtures` | the folder of the fixtures |
| `schema` | `null` | a local OpenAPI 3 JSON file (`.json`). `run` and `fixtures` check each fixture against it. YAML files and URLs are not read. For an API in another repository, the document it publishes, kept here at `docs/runbooks/_contract/openapi.json` by default (`upstream.md`, Another repository). `contract` checks calls and fixtures against it, and `list --affected` reads its changes (`upstream.md`, Contract) |
| `redactHeaders` | `[]` | header names the recorder drops, besides `set-cookie`, `authorization` and `cookie`. Case does not matter |
| `redactBodyKeys` | `[]` | key names the recorder drops from recorded request bodies and GraphQL variables, besides `password`, `token` and `secret`. A key whose name contains one of them is dropped, at any depth. Case does not matter |
| `tokenEnv` | `""` | env var holding a service token, for an upstream API without password login |
| `serverFile` | `null` | where `setup` copied the upstream server, relative to this project: `<tests.ui.dir>/runbooks-upstream.mjs`, `<tests.ui.root>/<tests.ui.dir>/runbooks-upstream.mjs` with a UI tests repository, or `<paths.runbooks>/runbooks-upstream.mjs` without `tests.ui`. The `runbooks:upstream` script of `package.json` runs it, and `run` starts it (`upstream.md`, "The copy in the project") |

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
- `upstream.redactBodyKeys must be a list of key names`

## Models

On Claude Code, the optional `models` block sets which model runs each command. It maps a row key to one of `inline`, `haiku`, `sonnet`, `opus` or `fable`. `inline` runs the command in the main session, with no sub-agent. Any other value launches the command's sub-agents on that model. The five values run from least to most capable in that order. A config without `models` uses the default table below, and a project's rows replace the default rows with the same key.

A key is a command name followed by options and `<placeholder>` positionals, as in `run --mode test` or `help <question>`. A row matches an invocation when the command is the same, every option in the key is given (an option with a value must have that value), and a placeholder has a positional argument to match. When several rows match, the row with the most options and placeholders wins. On a tie, the more capable model wins. An invocation that no row matches runs `inline`. `--model <value>` on the command line overrides every row.

| Row | Model |
|---|---|
| `check` | `inline` |
| `list` | `inline` |
| `ui` | `inline` |
| `upgrade` | `inline` |
| `roles:list` | `inline` |
| `contexts:list` | `inline` |
| `help` | `inline` |
| `setup` | `inline` |
| `settings` | `inline` |
| `roles:create` | `inline` |
| `roles:update` | `inline` |
| `roles:delete` | `inline` |
| `contexts:create` | `inline` |
| `contexts:update` | `inline` |
| `contexts:delete` | `inline` |
| `permissions:manage` | `inline` |
| `orchestrator` | `inline` |
| `run --mode guided` | `inline` |
| `coverage` | `haiku` |
| `run --mode test` | `haiku` |
| `run --mode prompt` | `haiku` |
| `run --import` | `haiku` |
| `run` | `sonnet` |
| `help <question>` | `sonnet` |
| `whats-next` | `sonnet` |
| `map` | `sonnet` |
| `audit` | `sonnet` |
| `roles:generate` | `sonnet` |
| `audit --fix` | `opus` |
| `create` | `opus` |
| `update` | `opus` |
| `to-test` | `opus` |

A value outside the five is a config error: `models["<key>"] must be one of inline, haiku, sonnet, opus, fable`. `models` itself must be an object or `null`, or the loader raises `models must be an object of "<command> [parameters]": model`.

A key that is not a command with options and placeholders, an empty key, or a key whose command does not exist is not an error. The loader warns `models["<key>"]: <reason>; the row is ignored` and leaves the row out.

`setup` writes the table into a project that has no `models` key. `/runbooks:settings models` changes it.

### Codex models

Codex uses a separate optional `codex.models` object with the same row keys. Its
defaults keep every `inline` row above and replace every delegated Claude alias
with `inherit`, which delegates using the current session model. Legacy projects
need no migration to be read on Codex; absent Codex rows receive those defaults.
The helper does not write the configuration while reading it.

```json
{
  "models": { "create": "opus" },
  "codex": { "models": { "create": "inherit", "coverage": "inline" } }
}
```

`inline` executes in the main session. `inherit` delegates with no model override.
An explicit model ID must be supported by the active Codex session. The helper
validates a nonempty ID of up to 200 characters: letters/digits first, then
letters/digits, `.`, `_`, `:`, `/` or `-`, with no `..` sequence. Claude aliases
are rejected. Runtime availability is checked at dispatch, not guessed by the
helper. A forced unavailable model stops; see `agents.md` for fallback behavior.

The most specific matching row wins as on Claude. Equally specific Codex rows
keep the first matching row in the effective table (defaults followed by new
project rows; replacing an existing row does not move it). No capability ranking
is inferred from OpenAI model names. `--model` overrides row selection and passes
through internal calls. `setup` and `settings models` edit only the active host's
block, preserving the other one.

Use `runbooks.mjs model <command> <args> --runtime codex --json` and
`runbooks.mjs models --runtime codex [--defaults|--diff] --json`. Omit the runtime
only for legacy Claude behavior. An unknown runtime is an error. Invalid Codex
row keys are ignored with warnings under `codex.models`, as for Claude rows.

## Sources

Each `entries` or `requirements` item is one source. Every source accepts `root`, a folder of the project relative to its root (for a monorepo: `"apps/api"`). Ids from a rooted source keep the root in their `file` (`apps/api/src/app/...`), and `slices` globs match that same path. An API in another repository is never a source: CI checks out this repository alone, so the source would never run there (`${RUNBOOKS_PLUGIN_ROOT}/docs/adr/0005-upstream-api-in-another-repo-is-a-contract.md`).

| `extractor` | Fields | Produces |
|---|---|---|
| `next-app-router` (entries) | `glob`, optional `dropSegments` (default `["[locale]", "[lang]"]`) | one `ui-route` per `page.*`, one `api-endpoint` `METHOD /path` per exported handler in `route.*`. Route groups `(x)` and slots `@x` are dropped; dynamic segments keep brackets (`/deliveries/[id]`) |
| `regex` (entries, requirements) | `glob`, `pattern` with a named group `id`, optional `method` and `title` groups, optional `flags` (default `m`), optional `kind` for entries | one item per match; `method` turns the id into `METHOD id` |
| `command` (requirements) | `command` | runs the command in `root`, reads a JSON array of `{ "id", "title" }` |

Globs support `*` (inside one folder) and `**` (any depth). `[`, `]`, `(`, `)` are literal characters.

A source whose `root` does not exist is skipped with a warning; the others still count.

Warnings the loader prints for paths outside the project (from runbooks 2.0 the first three are config errors):

- `entries[<n>]: root "<root>" is outside the project, so its CI never reads it (docs/adr/0005). /runbooks:settings sources moves its ids to calls. ...`
- `slices.<name>: glob "<glob>" is outside the project and never matches a change (docs/adr/0005). ...`
- `tests.api.root "<root>" is outside the project (docs/adr/0005). ...`. A `tests.ui.root` outside the project does not warn (docs/adr/0007).
- `upstream.root is no longer read (docs/adr/0005); /runbooks:settings upstream removes it`
