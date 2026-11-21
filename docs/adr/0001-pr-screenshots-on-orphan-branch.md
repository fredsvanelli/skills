# PR screenshots live on an orphan `pr-assets` branch, linked by commit SHA

`utils:generate-pr-description` publishes the screenshots it takes to an orphan branch `pr-assets` in the consumer repository and links them in the PR body as `https://github.com/<owner>/<repo>/blob/<sha>/<path>?raw=true`. GitHub has no API to attach an image to a PR body, and this keeps the images out of the PR's diff and `main`'s history, renders in private repos for logged-in viewers, and needs only `git` and a push.

## Considered Options

- Commit the images on the PR branch: they land in the diff and in `main` after merge.
- Keep them local and let the author drag them into GitHub: still manual, the problem we started from.
- Upload through the GitHub web UI with a browser tool (`user-attachments` URLs): fragile, needs a connected Chrome.

## Consequences

- Every PR body with images depends on `pr-assets` existing and its commits staying reachable. Never force-push or delete `pr-assets`; `utils:cleanup-branches` lists it as protected.
- In a public repository the images are public forever, even after the PR closes. The skill states the repository's visibility when it asks before the push.
- `pr-assets` only grows. Pruning it would break the links in old PRs.
