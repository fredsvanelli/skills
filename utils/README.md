# utils

| Command | Does |
|---|---|
| `/utils:cleanup-branches` | deletes branches already merged into production or develop, locally or with `--origin`, then fast-forwards the rest |
| `/utils:cleanup-dependabot` | empties the Dependabot PR queue through `develop`: rebases, merges green CI, asks before majors, closes PRs already covered |

`cleanup-dependabot` assumes `target-branch: develop` in `.github/dependabot.yml`, `gh` and `python3`, and required checks named `Lint`, `Typecheck`, `Build` and `Unit tests` (`REQUIRED_CHECKS` in `scripts/dependabot.py`).

## Install

    claude plugin marketplace add fredsvanelli/skills
    claude plugin install utils@fredsvanelli
