# Runbooks

Runbooks are this project's UAT scripts: one flow per file. A `ui` runbook is verified in the browser; an `api` runbook through its test script, listed in its `scripts`. They are the official record of how the product behaves.

They are managed with the `runbook` Claude Code plugin from the `fredsvanelli` marketplace (`/runbooks:*`).

## Layout

- `<capability>/<flow>.md`: one runbook. Its id is `<capability>.<flow>`.
- `_runs/`: one report per execution; `/runbooks:ui` shows them. Local only: Git ignores its contents.
- `_coverage/`: the latest coverage report, overall and per slice. Local only: Git ignores its contents.
- `_fixtures/`: the responses `mocked` runbooks get from the upstream server, one folder per runbook.
- `_contract/openapi.json`: when the upstream API lives in another repository, the OpenAPI document it publishes, brought in by this project's CI. Runbooks list the operations they reach in `calls`, which never count as coverage.
- `runbooks.config.json`: project settings for the commands.

## Lifecycle

1. `map` writes a `placeholder` for each flow no runbook cites: a title and goal, no steps. `create` writes a runbook as `draft`, filling the placeholder of its flow when there is one. When the behavior changes, `update` edits its steps and keeps its status until the next full run.
2. `run` executes it (an `api` runbook gets its script from `to-test` first, when it has none). A full run where every step passes (or is waived, with at least one pass) makes it `active`.
3. Only `active` runbooks count as coverage; `draft` ones count as pending, placeholders as planned.
4. `audit-runbooks` checks runbooks against the code; `coverage` measures coverage.
5. `deprecated` runbooks stay for history and never count.

## Commands

| Command | Does |
|---|---|
| `/runbooks:list` | lists runbooks, or the ones a diff affects (`--affected`) |
| `/runbooks:map` | writes a placeholder runbook for each flow no runbook cites |
| `/runbooks:create` | writes a runbook from a spec, diff, ticket, description or placeholder |
| `/runbooks:update` | updates the steps of a runbook after the behavior it records changed |
| `/runbooks:run` | runs runbooks: `ui` ones with `--mode guided`, `headless`, `headed`, `chrome` or `prompt`; `api` ones through their test script |
| `/runbooks:check` | shows the result of a runbook's latest run, or says it was never run |
| `/runbooks:to-test` | writes or adopts the test script of a runbook |
| `/runbooks:audit-runbooks` | checks runbooks still match the code |
| `/runbooks:coverage` | coverage report |
| `/runbooks:setup` | (re)configures this folder |
| `/runbooks:settings` | changes part of the config, such as the test library, the design reference or the commit policy |
| `/runbooks:ui` | opens a local page with capabilities, runbooks, run history and coverage |
| `/runbooks:upgrade` | updates the installed plugin to its latest version |
| `/runbooks:roles:create` | registers a role with its parents, account and permissions |
| `/runbooks:roles:update` | changes a role's description, parents or account, or renames it |
| `/runbooks:roles:delete` | removes a role from the registry, the config and the runbooks that cite it |
| `/runbooks:roles:list` | lists the roles, or shows one with its effective permissions |
| `/runbooks:roles:manage-permissions` | changes what a role may do on each capability/feature key and marks the runbooks the change reaches for review |
