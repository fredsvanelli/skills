<!-- runbook:start -->
## Runbooks

UAT runbooks in `docs/runbooks/` are the official record of how the product behaves. Read `docs/runbooks/README.md` before editing one.

- Feature work creates or updates the runbook of every flow it changes (`/runbook:create` for a new flow, `/runbook:update` for one that has a runbook).
- Before calling work done, run `/runbook:list --affected`, then `/runbook:run --affected`. A failing runbook means the work is not done.
- `ui` runbook results are verified in the browser only. `api` runbook results are verified only by their scripts (the files in `scripts:`), run with the project's test command.
<!-- api-scripts: setup replaces this line with templates/api-practices.md filled for this project, when the stack has api runbooks -->
<!-- runbook:end -->
