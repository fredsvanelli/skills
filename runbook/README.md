# runbook

UAT runbooks kept in `docs/runbooks/` as the project's verified knowledge base. The agent writes them, runs them in the browser, audits them against the code and measures coverage.

| Command | Does |
|---|---|
| `/runbook:setup` | prepares a project: folders, config, agents block, Playwright MCP servers |
| `/runbook:list` | lists runbooks, filtered or by what a diff affects |
| `/runbook:create` | writes a runbook from a spec, diff, ticket or description |
| `/runbook:update` | updates the steps of a runbook after the behavior it records changed |
| `/runbook:run` | runs runbooks: guided, headless, headed, Claude in Chrome, or as a prompt for the Chrome extension |
| `/runbook:check` | shows the result of a runbook's latest run, or says it was never run |
| `/runbook:to-script` | turns a runbook into a Playwright spec |
| `/runbook:audit-script` | checks runbooks still match the code |
| `/runbook:audit-code` | coverage report, overall or per capability, feature, slice or path |

## Install

    claude plugin marketplace add fredsvanelli/skills
    claude plugin install runbook@fredsvanelli

## Local development

    claude --plugin-dir runbook

Run `/reload-plugins` after editing. Tests: `yarn --cwd runbook test` (Node 18+).
