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
| `/runbooks:audit` | checks runbooks still match the code |
| `/runbooks:coverage` | coverage report, overall or per capability, feature, slice or path |
| `/runbooks:ui` | opens a local page with capabilities, runbooks, run history and coverage |
| `/runbooks:upgrade` | updates the installed plugin to the latest version from its marketplace |
| `/runbooks:help` | answers a question about the plugin from its own docs, optionally limited to one area (`--about roles`) |
| `/runbooks:whats-next` | compares the runbooks with the code and the latest commits or uncommitted changes, and suggests the three commands that make the most sense to run now |
| `/runbooks:orchestrator` | drives up to N agents that take runbooks through the whole flow (`map`, `create`, `run`, `to-test`) in parallel until a goal is met, answering their questions or relaying them to the user |
| `/runbooks:roles:create` | registers a role with its parents, account and permissions |
| `/runbooks:roles:update` | changes a role's description, parents or account, or renames it |
| `/runbooks:roles:delete` | removes a role from the registry, the config and the runbooks that cite it |
| `/runbooks:roles:list` | lists the roles, or shows one with its effective permissions |
| `/runbooks:roles:generate` | reads any document about who may do what (text, CSV, spreadsheet, JSON, PDF) and proposes the roles, contexts and permissions it describes, merged into `roles.json` |
| `/runbooks:contexts:list` | lists the contexts, or shows one with its runbooks |
| `/runbooks:contexts:create` | registers a context with its keys and cases, and marks the runbooks it reaches for review |
| `/runbooks:contexts:update` | changes a context's keys, cases or description, and marks the runbooks the change reaches for review |
| `/runbooks:contexts:delete` | removes a context from the registry and its runbooks, and marks the runbooks where a role's actions changed for review |
| `/runbooks:permissions:manage` | changes what a role may do on each capability/feature key and marks the runbooks the change reaches for review |

With `roles.enabled` on, the project keeps a role registry in `roles.json` inside the runbooks folder. A runbook lists the roles it covers, or `roles: all` for every registered role, and each run, script and audit pass then repeats once per role, with the expected outcome per role in each step (`allowed`, `read-only`, `hidden`, `denied` or `partial`). Steps that do not apply to a role, or a role without a test account, get their own states instead of failing. Changing a role or its permissions marks the runbooks it reaches with a `review` reason, which `/runbooks:update` clears once their role lines are right. Setup asks whether to track roles and settings can turn tracking on later; with it off, everything behaves as before. See Roles in [config](skills/runbooks/references/config.md) and in [format](skills/runbooks/references/format.md).

A `ui` runbook reaches its upstream API in one of two modes. In `live` mode, it calls the real API with test data. In `mocked` mode, the upstream server serves fixtures, and the app points at that server through the env var named in `upstream.urlEnv`. `setup` copies the server into the project and adds a `runbooks:upstream` script, so `npm run runbooks:upstream` starts it from the config; `run` starts the same copy ([ADR 0011](docs/adr/0011-the-agent-runs-the-projects-copy-of-the-upstream-server.md)). The project default is `upstream.mode` in the config, and a runbook can override it with `upstream:`. A mocked runbook proves what the screen shows and sends. It never covers an endpoint. See [upstream mode](skills/runbooks/references/upstream.md).

When the upstream API lives in another repository, each repository has its own runbooks install and neither reads the other's files. The front lists the operations its screens reach in `calls`, which never count as coverage, and keeps the OpenAPI document the API publishes as `upstream.schema`. `runbooks.mjs contract --strict` checks calls and fixtures against that document, and `list --affected` names the runbooks a new version of it reaches. The API's install covers its endpoints. See [ADR 0005](docs/adr/0005-upstream-api-in-another-repo-is-a-contract.md).

The UI tests may live in a repository of their own, such as `project-001-e2e` next to `project-001`. Setup asks where they live and writes the relative path to `tests.ui.root`. The runbooks, the fixtures and the coverage stay in the app's repository, and the scripts and the upstream server copy go to the UI tests repository, committed there. See [ADR 0007](docs/adr/0007-ui-tests-may-live-in-another-repo.md).

A `models` table in the config names the model each command runs on, per command and per parameter, such as `run --mode test` on `haiku` and `create` on `opus`. A row set to `inline` runs the command in the main session. Any other row makes the main session launch a sub-agent on that model, relay its questions and print its result. `setup` writes the default table, `settings` changes any row, and every command accepts `--model inline|haiku|sonnet|opus|fable` to force one model for one invocation. See Models in [config](skills/runbooks/references/config.md) and [ADR 0010](docs/adr/0010-each-command-runs-on-the-model-its-row-names.md).

## Install

    claude plugin marketplace add fredsvanelli/skills
    claude plugin install runbooks@fredsvanelli

## Local development

    claude --plugin-dir runbooks

Run `/reload-plugins` after editing. Tests: `yarn --cwd runbooks test` (Node 18+).
