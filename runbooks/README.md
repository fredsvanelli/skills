# runbooks

UAT runbooks kept in `docs/runbooks/` as the project's verified knowledge base. The agent writes them, runs them (`ui` runbooks in the browser, `api` runbooks through a test script it writes or adopts), audits them against the code and measures coverage. Frontend, backend and fullstack projects are supported.

| Command | Does |
|---|---|
| `/runbooks:setup` | prepares a project: stack, technology and test library per surface, design reference (Figma, Claude Design, Adobe XD exports, local files) and its MCP server, folders, config, agents block, Playwright MCP servers |
| `/runbooks:settings` | changes part of what setup configured (stack, test library, design reference, accounts, viewports, commit policy, ...) and the files that depend on it, without asking every setup question again |
| `/runbooks:list` | lists runbooks, filtered or by what a diff affects |
| `/runbooks:map` | scans the code and writes a placeholder runbook for each flow no runbook cites |
| `/runbooks:create` | writes a runbook from a spec, diff, ticket, description, code file, directory, route or placeholder, filling the matching placeholder, with one step per happy path, expected error and edge case it finds in the code; for a `ui` runbook, asks the screen sizes it runs at and links its screens to their designs |
| `/runbooks:update` | updates the steps of a runbook after the behavior it records changed |
| `/runbooks:run` | runs runbooks: `ui` ones guided, headless, headed, in Claude in Chrome or as a prompt for the Chrome extension, once per screen size, comparing each linked screen with its design; `api` ones through their test script |
| `/runbooks:check` | shows the result of a runbook's latest run, or says it was never run |
| `/runbooks:to-test` | writes or adopts the test script of a runbook, in the project's test library |
| `/runbooks:audit-runbooks` | checks runbooks still match the code |
| `/runbooks:coverage` | coverage report, overall or per capability, feature, slice or path |
| `/runbooks:upgrade` | updates the installed plugin to the latest version from its marketplace |

A `ui` runbook reaches its upstream API in one of two modes. In `live` mode, it calls the real API with test data. In `mocked` mode, the plugin's upstream server serves fixtures, and the app points at that server through the env var named in `upstream.urlEnv`. The project default is `upstream.mode` in the config, and a runbook can override it with `upstream:`. A mocked runbook proves what the screen shows and sends. It never covers an endpoint. See [upstream mode](skills/runbooks/references/upstream.md).

## Install

    claude plugin marketplace add fredsvanelli/skills
    claude plugin install runbooks@fredsvanelli

## Local development

    claude --plugin-dir runbooks

Run `/reload-plugins` after editing. Tests: `yarn --cwd runbooks test` (Node 18+).
