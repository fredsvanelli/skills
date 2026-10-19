# Runbooks

Runbooks are this project's UAT scripts: one user flow per file, verified in the browser. They are the official record of how the product behaves.

They are managed with the `runbook` Claude Code plugin from the `fredsvanelli` marketplace (`/runbook:*`).

## Layout

- `<capability>/<flow>.md`: one runbook. Its id is `<capability>.<flow>`.
- `_runs/`: one report per execution. Local only: Git ignores its contents, except `output.json` and `output.html`, the table of every runbook with the date and result of its last full run.
- `_coverage/`: the latest coverage report, overall and per slice. Local only: Git ignores its contents.
- `runbook.config.json`: project settings for the commands.

## Lifecycle

1. `map` writes a `placeholder` for each flow no runbook cites: a title and goal, no steps. `create` writes a runbook as `draft`, filling the placeholder of its flow when there is one. When the behavior changes, `update` edits its steps and keeps its status until the next full run.
2. `run` executes it. A full run where every step passes (or is waived, with at least one pass) makes it `active`.
3. Only `active` runbooks count as coverage; `draft` ones count as pending, placeholders as planned.
4. `audit-script` checks runbooks against the code; `coverage` measures coverage.
5. `deprecated` runbooks stay for history and never count.

## Commands

| Command | Does |
|---|---|
| `/runbook:list` | lists runbooks, or the ones a diff affects (`--affected`) |
| `/runbook:map` | writes a placeholder runbook for each flow no runbook cites |
| `/runbook:create` | writes a runbook from a spec, diff, ticket, description or placeholder |
| `/runbook:update` | updates the steps of a runbook after the behavior it records changed |
| `/runbook:run` | runs runbooks: `--mode guided`, `headless`, `headed`, `chrome` or `prompt` |
| `/runbook:check` | shows the result of a runbook's latest run, or says it was never run |
| `/runbook:to-script` | turns a runbook into a Playwright spec |
| `/runbook:audit-script` | checks runbooks still match the code |
| `/runbook:coverage` | coverage report |
| `/runbook:setup` | (re)configures this folder |
| `/runbook:upgrade` | updates the installed plugin to its latest version |
