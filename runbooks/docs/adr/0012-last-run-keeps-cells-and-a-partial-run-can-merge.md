# last_run keeps a state per cell, and a partial run can merge into it

`last_run` held one `date`, `commit`, `result` and `report` for the whole runbook. A run with `--steps`, `--role` or `--case` left it and `status` unchanged. A user ran `billing.issue-invoice` in full, S02 failed, they fixed the bug and ran `--steps S02`, which passed, and `last_run` still said `failed`. Clearing it took another full run. The same happened with nine roles, where eight passed and one had a small bug. Now `last_run` keeps a state per cell, where a cell is a step with its role, case and viewport, and each cell names the run that proved it in `runs`. `run --merge` with `--steps`, `--role` or `--case` writes the cells of that run and keeps every other cell as it was. `result` comes from all cells (`failed`, `blocked`, `incomplete` while a cell is pending, then `passed`), `mixed: true` says the cells come from more than one run, and `oldest` is the date `stale` ages from. `status` moves only when no cell is pending or outdated. A partial run without `--merge` behaves as before. `runbooks.mjs last-run`, `mark-outdated` and `rename-role-cells` do the writes, so the agent never edits the cells by hand. The old one-line `last_run` is still read. `mark-outdated` keeps it one line, and the next `last-run` write converts it.

## Considered Options

- Always merge a partial run. Rejected by the user, who wants an explicit flag: a partial run that proves one step should not quietly rewrite a result the person did not ask to change.
- One result for the whole runbook. Rejected: it hides which run proved which step, role or case, and a fix to one cell would still need a full run.
- The agent merges the cells by hand. Rejected: the merge must never touch a cell the report did not cover, and a script checks that where a prompt cannot.

## Consequences

- Reports sit in `_runs/` and Git ignores them, so another clone cannot rebuild cells from old reports. The cells in the frontmatter are what travels with the repository.
- A runbook with the old one-line `last_run` has every cell pending after its first merge, so its `result` is `incomplete` and its `status` stays until a full run or more merges fill the cells.
- `update` and `audit --fix` mark every cell outdated, not only the cells of the edited step, because a change to one step or a precondition can change what later steps see.
- A `no-account` row fills only a pending cell, because the accounts in `mcp.secretsFile` differ from one machine to the next.
- `rename-case` and `rename-role-cells` move the cells to the new name, and a cell whose step, role, case or viewport no longer exists is dropped on the next write.
- The orchestrator launches full runs and never passes `--merge`.
