# Runbooks

Runbooks are this project's UAT scripts: one user flow per file, verified in the browser. They are the official record of how the product behaves.

They are managed with the `fredsvanelli` Claude Code plugin (`/fredsvanelli:runbook:*`).

## Layout

- `<capability>/<flow>.md`: one runbook. Its id is `<capability>.<flow>`.
- `_runs/`: one report per execution.
- `_coverage/`: the latest coverage report, overall and per slice.
- `runbook.config.json`: project settings for the commands.

## Lifecycle

1. `create` writes a runbook as `draft`. When the behavior changes, `update` edits its steps and keeps its status until the next full run.
2. `run` executes it. A full run where every step passes (or is waived, with at least one pass) makes it `active`.
3. Only `active` runbooks count as coverage.
4. `audit-script` checks runbooks against the code; `audit-code` measures coverage.
5. `deprecated` runbooks stay for history and never count.

## Commands

| Command | Does |
|---|---|
| `/fredsvanelli:runbook:list` | lists runbooks, or the ones a diff affects (`--affected`) |
| `/fredsvanelli:runbook:create` | writes a runbook from a spec, diff, ticket or description |
| `/fredsvanelli:runbook:update` | updates the steps of a runbook after the behavior it records changed |
| `/fredsvanelli:runbook:run` | runs runbooks: `--mode guided`, `headless`, `headed`, `chrome` or `prompt` |
| `/fredsvanelli:runbook:to-script` | turns a runbook into a Playwright spec |
| `/fredsvanelli:runbook:audit-script` | checks runbooks still match the code |
| `/fredsvanelli:runbook:audit-code` | coverage report |
| `/fredsvanelli:runbook:setup` | (re)configures this folder |
