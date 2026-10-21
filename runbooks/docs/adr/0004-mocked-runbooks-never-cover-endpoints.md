# Mocked ui runbooks never cover endpoints

ADR 0002 lets a `ui` runbook in a `frontend` stack cover the endpoints it cites. A `mocked` runbook never reaches its upstream API: it proves what the screen shows and the request the screen sends, not what the API does with that request. So a `mocked` runbook covers only its `ui-route` entries, whatever the stack. It still lists the endpoints its screens call in `covers.entries`, so `list --affected` finds it when one of them changes and its fixtures may be out of date. `/runbooks:ui` shows an endpoint that only `mocked` runbooks cite as "cited, not covered (mocked)", so the gap has its reason next to it.

## Considered Options

- Counting a `mocked` runbook like any `ui` runbook. Rejected: coverage would report endpoints as proven when only fixtures answered them.
- Leaving the endpoints out of a `mocked` runbook's `covers.entries`. Rejected: `list --affected` would no longer find the runbook when the API it mocks changes.

## Consequences

In a `frontend` stack whose default upstream mode is `mocked`, the endpoints from a sibling repo are covered only by `live` `ui` runbooks. `setup` says so when it recommends `mocked`, and the first `coverage` after a project switches to `mocked` shows endpoint coverage drop.

For an upstream API in another repository, ADR 0005 replaces this: the front lists those endpoints in `calls`, and they are covered only in the API's own install.
