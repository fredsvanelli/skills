# A mocked upstream API is served by a plugin server the app points at

A `mocked` `ui` runbook runs in every browser mode and through its script, so the mock cannot live in the browser driver. The plugin ships a dependency-free Node server (`runbooks.mjs upstream`) that listens on `127.0.0.1:<upstream.port>`, and the app starts with `upstream.urlEnv` pointing at it. The server serves the runbook's fixtures, chosen by method, path and query, with a folder per step for a request whose response changes between steps; the agent or the script's `beforeEach` names the current runbook, mode and step through `POST /__runbooks/select`. A request with no fixture gets a 501 that names it, and the step that needed it is `blocked`. When the project has any `mocked` runbook, the same server also proxies `live` runbooks to `upstream.baseUrl` and records fixtures in `record` mode, so switching modes inside one `run` is a control call, not an app restart. We chose this because it is the only option that works in `guided`, `chrome` and `prompt`, sees the calls an app makes from its server (Server Components, route handlers, server actions), and gives browser runs and scripts the same fixtures. A project that already has MSW keeps its own handlers instead.

## Considered Options

- Interception in the browser driver (`browser_route` with `--caps=network` on Playwright MCP, `page.route`, `cy.intercept`). Rejected: it works only in `headless`, `headed`, `script` and scripts, and it never sees requests the app's server makes.
- Requiring the project's own mock layer (MSW). Rejected as the only path: the plugin would depend on every project having one. It stays the choice when the project already has it.
- Restarting the app between `live` and `mocked` groups, or running two app instances on different ports. Rejected: a mixed `run --affected` would stop for a restart at every switch, or the config would carry a second app to start and keep in sync.
- Passing an unmatched request through to the live API. Rejected: it mixes modes inside one runbook without anyone noticing.

## Consequences

- In a project with any `mocked` runbook, `live` runbooks also go through the proxy, which must pass SSE as a stream and WebSocket through Node's `upgrade` event. A proxy bug shows up in `live` runs too.
- `setup` copies the server into the project (`<tests.ui.dir>/runbooks-upstream.mjs`) so the project's CI runs mocked scripts without the plugin. The file carries the plugin version in a comment; `list` and `coverage` warn when it differs from the installed plugin and `setup` refreshes it, and `upgrade` offers to run `setup`.
- Recording needs one `live` execution of the flow (`run <id> --record`). When the live API does not answer, fixtures come from `upstream.schema` or are written by hand, and each one says where it came from in `source`.
