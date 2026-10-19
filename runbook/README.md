# runbook

UAT runbooks kept in `docs/runbooks/` as the project's verified knowledge base. The agent writes them, runs them (`ui` runbooks in the browser, `api` runbooks through a test script it writes or adopts), audits them against the code and measures coverage. Frontend, backend and fullstack projects are supported.

| Command | Does |
|---|---|
| `/runbook:setup` | prepares a project: stack, technology and test library per surface, folders, config, agents block, Playwright MCP servers |
| `/runbook:list` | lists runbooks, filtered or by what a diff affects |
| `/runbook:map` | scans the code and writes a placeholder runbook for each flow no runbook cites |
| `/runbook:create` | writes a runbook from a spec, diff, ticket, description or placeholder, filling the matching placeholder |
| `/runbook:update` | updates the steps of a runbook after the behavior it records changed |
| `/runbook:run` | runs runbooks: `ui` ones guided, headless, headed, in Claude in Chrome or as a prompt for the Chrome extension; `api` ones through their test script |
| `/runbook:check` | shows the result of a runbook's latest run, or says it was never run |
| `/runbook:to-test` | writes or adopts the test script of a runbook, in the project's test library |
| `/runbook:audit-runbook` | checks runbooks still match the code |
| `/runbook:coverage` | coverage report, overall or per capability, feature, slice or path |
| `/runbook:upgrade` | updates the installed plugin to the latest version from its marketplace |

## Install

    claude plugin marketplace add fredsvanelli/skills
    claude plugin install runbook@fredsvanelli

## Local development

    claude --plugin-dir runbook

Run `/reload-plugins` after editing. Tests: `yarn --cwd runbook test` (Node 18+).
