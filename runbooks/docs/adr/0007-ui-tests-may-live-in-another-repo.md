# The UI tests may live in another repository

Some teams keep their end-to-end suite in a repository of its own: the app runs from `/my-projects/project-001` and its Playwright tests live in `/my-projects/project-001-e2e`. The runbooks stay in the app's repository, because they describe the app's screens and count coverage against the app's own entries. Only the scripts move. `tests.ui.root` holds the path of that repository relative to the project root (`"../project-001-e2e"`), and `tests.ui.dir` is relative to that root, as it is for any `root`. A runbook's `scripts` stay relative to the project root (`../project-001-e2e/tests/billing/pay.runbook.spec.ts`), and `run` turns them into paths relative to `tests.ui.root` before it fills `{files}`. The loader no longer warns about a `tests.ui.root` outside the project. This narrows ADR 0005 for `tests.ui` only: `entries` sources, `slices` globs and `tests.api.root` still resolve inside the project.

We accept the sibling path for the scripts, and not for the sources, because nothing the app's CI reports depends on it. Coverage, orphans, slices and `list --affected` read the runbooks and the app's code, which are all in this repository, so CI and a laptop report the same numbers whether the e2e repository is cloned or not. The scripts run in the e2e repository's CI, which checks out the app anyway to start it.

## Considered Options

- An env var that holds the e2e repository's path, with `root` as the fallback. Rejected for now: the plain relative path covers the usual layout of two clones side by side, and the loader already reads `root`. A team with another layout can still set `root` to its own relative path.
- Moving the runbooks into the e2e repository. Rejected: coverage would then read the app's code from a sibling folder, the case ADR 0005 rules out.
- Keeping the warning and the 2.0 error for every `tests.<surface>.root`. Rejected: the team would have no supported way to keep its existing suite.
- Allowing `tests.api.root` outside the project too. Rejected: an API in another repository has its own runbooks install (ADR 0005), and its `api` runbooks run there.

## Consequences

- Every developer clones the e2e repository at the same path relative to the app. `run` in mode `test` and `to-test` stop when `tests.ui.root` does not exist and say where to clone it.
- `setup` and `settings` may read the e2e repository, but only the folder the user named: its manifest, its framework config and two or three of its tests.
- `setup` copies the upstream server to `<tests.ui.root>/<tests.ui.dir>/runbooks-upstream.mjs`, inside the e2e repository, so its CI runs mocked scripts without the plugin. The fixtures stay in the app's repository, and the e2e CI reads them from its checkout of the app. `list` and `coverage` do not warn about a missing copy when the e2e repository is not cloned.
- A command that writes files in the e2e repository commits them there, in a commit of its own, by the same policy as the files it writes here (`commits.md`, Another repository).
