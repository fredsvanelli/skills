<!-- runbook:start -->
## Runbooks

UAT runbooks in `docs/runbooks/` are the official record of how the product behaves. Read `docs/runbooks/README.md` before editing one.

- Feature work creates or updates the runbook of every flow it changes (`/runbook:create` for a new flow, `/runbook:update` for one that has a runbook).
- Before calling work done, run `/runbook:list --affected`, then `/runbook:run --affected`. A failing runbook means the work is not done.
- Runbook results are verified in the browser only.
<!-- runbook:end -->
