# utils

| Claude Code | Codex | Does |
|---|---|---|
| `/utils:cleanup-branches` | `$utils:cleanup-branches` | deletes branches already merged into production or develop, locally or with `--origin`, then fast-forwards the rest |
| `/utils:cleanup-dependabot` | `$utils:cleanup-dependabot` | empties the Dependabot PR queue through `develop`: rebases, merges green CI, asks before majors, closes PRs already covered |
| `/utils:generate-pr-description` | `$utils:generate-pr-description` | writes a PR description from the branch's real diff, for the reviewer; `--apply` writes it to the PR with `gh` |

`cleanup-dependabot` needs `gh`, `python3`, `target-branch: develop` in `.github/dependabot.yml`, and `DEPENDABOT_REQUIRED_CHECKS` with the names of every required check. For Codex, export it in the shell running the helper:

```bash
export DEPENDABOT_REQUIRED_CHECKS="Lint,Typecheck,Build,Unit tests"
```

On Claude Code it can also come from the project's `.claude/settings.json`:

```json
{ "env": { "DEPENDABOT_REQUIRED_CHECKS": "Lint,Typecheck,Build,Unit tests" } }
```

## Install

Codex:

    codex plugin marketplace add fredsvanelli/skills
    codex plugin add utils@fredsvanelli

Start a new session and select a skill from the picker, or use its full name from
the table. No Claude environment variable is required; helpers resolve from the
installed skill's location. `gh` must be installed/authenticated where needed.

Claude Code:

    claude plugin marketplace add fredsvanelli/skills
    claude plugin install utils@fredsvanelli
