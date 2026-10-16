# fredsvanelli

Claude Code plugin with Fred Vanelli's skills.

## runbook

UAT runbooks kept in `docs/runbooks/` as the project's verified knowledge base. The agent writes them, runs them in the browser, audits them against the code and measures coverage.

| Command | Does |
|---|---|
| `/fredsvanelli:runbook:setup` | prepares a project: folders, config, agents block, Playwright MCP servers |
| `/fredsvanelli:runbook:list` | lists runbooks, filtered or by what a diff affects |
| `/fredsvanelli:runbook:create` | writes a runbook from a spec, diff, ticket or description |
| `/fredsvanelli:runbook:run` | runs runbooks: guided, headless, headed, Claude in Chrome, or as a prompt for the Chrome extension |
| `/fredsvanelli:runbook:to-script` | turns a runbook into a Playwright spec |
| `/fredsvanelli:runbook:audit-script` | checks runbooks still match the code |
| `/fredsvanelli:runbook:audit-code` | coverage report, overall or per capability, feature, slice or path |

## Local development

    claude --plugin-dir .claude/plugins/fredsvanelli

Run `/reload-plugins` after editing. Tests: `yarn --cwd .claude/plugins/fredsvanelli test` (Node 18+).
