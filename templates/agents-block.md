<!-- runbook:start -->
## Runbooks

UAT runbooks in `docs/runbooks/` are the official record of how the product behaves. Read `docs/runbooks/README.md` before editing one.

- Feature work creates or updates the runbook of every flow it changes (`/fredsvanelli:runbook:create`).
- Before calling work done, run `/fredsvanelli:runbook:list --affected`, then `/fredsvanelli:runbook:run --affected`. A failing runbook means the work is not done.
- Runbook results are verified in the browser only.
<!-- runbook:end -->
