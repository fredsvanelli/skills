# Changelog

## 0.5.0 — 2026-11-01

### Added

- `review-work`: rates a PR's delivery from 0 to 10 (one decimal) on spec match, unit and e2e tests, security, cyclomatic complexity, tech debt, error handling, performance, conventions, scope, backward compatibility and documentation, rating only the criteria the diff triggers (a style-only change skips tests, security, complexity…). Each criterion starts at 10 and loses a fixed amount per finding (blocker 6, major 3, minor 1, nit 0.5), counted once in a single criterion and only after it is confirmed in the code; findings that need a run go in a *Not verified* line instead. Weighted overall with a blocker cap at 4.0, a status icon per row (✅ 9.0 and up, ⚠️ 7.0 to 8.9, ❌ below 7.0, the overall row included), and a next step for every finding. Uses required CI checks, unresolved review threads and merge conflicts as evidence, filters lockfiles, snapshots and build output out of the diff, and without a PR also rates uncommitted and untracked changes. Read-only; reports in the project's predominant language.
- `review-work` helpers: `scripts/gather.py info` collects the PR, checks, unresolved threads, classified files, the tests that name or reference each changed code file (`FooTest.java`-style names included), spec sources and cyclomatic complexity (`lizard`, `radon` or `gocyclo` when installed) in one call. It scans the added lines for TODO/FIXME/HACK, skipped or focused tests, disabled lint rules, secret-looking literals and unsafe defaults (open CORS, TLS checks off), and lists the candidate findings the facts suggest: failing checks mapped to their criterion, code with no test, tests left unchanged, unresolved threads, functions the diff made more complex. `--diff` appends the filtered diff; `--template` writes the findings file with those candidates filled in, severity `?` where the rubric needs judgment and `next_step` empty, so nothing deducts until it is verified. `scripts/rate.py report` turns the verified findings into the rates, the weighted overall and the report, rejecting a finding in an N/A criterion, a cause counted twice or a candidate left unverified. `scripts/test_review_work.py` self-checks both helpers without `git` or `gh`.

## 0.4.0 — 2026-10-28

### Added

- OpenAI Codex support alongside Claude Code for `cleanup-branches`, `cleanup-dependabot` and `generate-pr-description`.
- Codex plugin packaging and marketplace registration, with installation and namespaced invocation examples.
- Shared runtime guidance for resource paths, file/shell tools and user questions on both hosts.

### Changed

- Resolve helpers from the loaded skill's location without requiring `CLAUDE_PLUGIN_ROOT`.
- Document `DEPENDABOT_REQUIRED_CHECKS` as a process environment variable, with Claude settings remaining an optional source; update the missing-variable diagnostic accordingly.
- Recognize `AGENTS.md` alongside `CLAUDE.md` for project conventions.

### Compatibility

Existing Claude commands and workflow boundaries remain unchanged: remote branch deletion needs `--origin`, PR-body updates need `--apply`, and major Dependabot updates retain their approval requirement. `cleanup-branches` still rejects unsupported `--dry-run`.

Restart the host after updating the plugin. No project data migration is required.
