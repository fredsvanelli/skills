# utils

| Command | Does |
|---|---|
| `/utils:cleanup-branches` | deletes branches already merged into production or develop, locally or with `--origin`, then fast-forwards the rest |
| `/utils:cleanup-dependabot` | empties the Dependabot PR queue through `develop`: rebases, merges green CI, asks before majors, closes PRs already covered |
| `/utils:generate-pr-description` | writes a PR description from the branch's real diff, for the reviewer; `--apply` writes it to the PR with `gh` |

`cleanup-dependabot` needs `gh`, `python3`, `target-branch: develop` in `.github/dependabot.yml`, and the names of the checks that must pass, in the project's `.claude/settings.json`:

```json
{ "env": { "DEPENDABOT_REQUIRED_CHECKS": "Lint,Typecheck,Build,Unit tests" } }
```

## Install

    claude plugin marketplace add fredsvanelli/skills
    claude plugin install utils@fredsvanelli
