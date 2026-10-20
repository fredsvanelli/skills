<!-- runbooks:start -->
## Runbooks

UAT runbooks in `docs/runbooks/` are the official record of how the product behaves. Read `docs/runbooks/README.md` before editing one.

- Feature work creates or updates the runbook of every flow it changes (`/runbooks:create` for a new flow, `/runbooks:update` for one that has a runbook).
- Before calling work done, run `/runbooks:list --affected`, then `/runbooks:run --affected`. A failing runbook means the work is not done.
- `ui` runbook results are verified in the browser, or by their script in mode `test` when the script has one test per step. The agent calls only the upstream server's control routes, which verify nothing. `api` runbook results are verified only by their scripts (the files in `scripts:`), run with the project's test command.
<!-- api-scripts: setup replaces this line with templates/api-practices.md filled for this project, when the stack has api runbooks -->
<!-- runbooks:end -->
