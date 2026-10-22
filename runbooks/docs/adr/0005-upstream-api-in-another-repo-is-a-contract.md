# An upstream API in another repository is a contract, not an entry source

When the upstream API of a `ui` project lives in another repository, that repository has its own runbooks install, and neither reads the other's files. CI checks out one repository at a time, so a source whose `root` points outside the project never runs there, and `list --affected` never sees the other repository's changes, because it diffs this repository only. So every `entries` source, `slices` glob and `tests.<surface>.root` resolves inside the project root. The endpoints a screen calls go in the runbook's `calls`, as `METHOD /path` templates of the upstream API. `calls` never counts as coverage and never makes an orphan. The upstream API's own install owns the coverage of its endpoints, through its `api` runbooks (ADR 0002). The contract between the two repositories is the OpenAPI 3 document the API publishes and the front keeps as `upstream.schema`. `runbooks.mjs contract` checks every call and every fixture against it, and `list --affected` turns a change of that file into the runbooks whose calls reach a changed operation. For an API in another repository, this replaces the part of ADR 0004 that kept a mocked runbook's endpoints in `covers.entries`: `list --affected` never found them there. A monorepo, where the API is a folder of the same repository, keeps ADR 0002 and ADR 0004 unchanged.

## Considered Options

- Keeping sibling sources and skipping them when the folder is missing. Rejected: coverage, orphans and the slice table then depend on what is cloned next to the project, so CI and a laptop report different numbers, and a skipped source turns off the orphan check for every entry.
- Reading the sibling's runbooks config to learn whether the API has its own install. Rejected: it reads the other repository, and the answer changes nothing the front does.
- Importing a manifest exported by the API's runbooks install (its endpoints and the `api` runbooks that cover them). Rejected for now: it ties both installs to one id format and to a new file format, and it says nothing about response shapes. An OpenAPI document carries the operations and their shapes, and the API does not need runbooks to publish one.
- Recorded fixtures as the contract. Rejected as the signal of a change: they change only when someone records again against a live API, so they cannot say when to record. They stay the data of mocked runbooks.
- Live runs as the only check. Rejected: the front's CI would need a deployed API with test data, and a change would show up late, as a failed step.
- Leaving the endpoints out of the runbook entirely. Rejected: the front would lose the list of runbooks that a changed operation reaches.
- Deriving the calls from the fixtures. Rejected: live runbooks have no fixtures, and fixtures hold concrete paths per step. `contract` checks that fixtures and calls agree instead.

## Consequences

- A project set up with a sibling source gets a warning from `list` and `coverage` until `/runbooks:settings sources` removes it. `runbooks.mjs move-to-calls` moves the endpoint ids from `covers.entries` to `calls`, as a dry run first.
- Endpoints of the other repository leave the front's coverage. The front's percentage measures its own entries, and the endpoints a `live` runbook used to cover count only in the API's install.
- Without `upstream.schema`, nothing in the front notices an API change before a `live` run. `setup` says so when the API publishes no OpenAPI document.
- The plugin fetches nothing. Bringing the published document into the front (a scheduled job, a bot pull request, a dispatch from the API's CI) is the project's CI.
- A `fullstack` stack spans one repository. A `root` outside the project warns in 1.4 and becomes a config error in 2.0. ADR 0007 lifts this for `tests.ui.root`: the UI tests may live in another repository.
