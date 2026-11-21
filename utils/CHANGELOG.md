# Changelog

## 0.7.0 — 2026-11-20

### Added

- `generate-pr-description`: takes the screenshots its `[SCREENSHOT HERE: X]` markers describe with the session's browser tool (claude-in-chrome, a Playwright MCP, Orca, Codex's browser), full page or only the element, whichever proves X, at 1280x800 (plus 390 wide when the diff touches responsive CSS). Drives only `localhost`/`127.0.0.1`, logs in only with an existing session or a documented dev user, never reads env files, and never captures a secret or real personal data. Reuses a running dev server only when it serves this checkout and branch, else starts one on a free port and stops only what it started; never runs a migration, seed or reset. Puts each kept capture in a fresh per-run folder, lists exactly those files and the visibility of `origin`'s repository before pushing (with `--apply`, one question: apply with the images, without them, or cancel), then publishes them to an orphan `pr-assets` branch on `origin` by git plumbing (runs in `bash` from any shell, working tree and index untouched, push hooks skipped, rebuilt once on a rejected push, git's error shown on failure) and links them by commit SHA under a slug of the branch name safe for URLs. Keeps the marker when there is no browser tool, the app does not start, the state is unreachable, the image is a "before", there is no GitHub remote or the user says no (with the local path).
- `generate-pr-description/publish.test.mjs`: runs the skill's publish block against a throwaway repo with a local bare remote (`node --test`), including a rejected-then-retried push and a push rejected every time.

### Changed

- `cleanup-branches`: `pr-assets` is protected.

## 0.6.0 — 2026-11-19

### Added

- `update-agent-docs`: decides whether the branch's work needs an edit to `CLAUDE.md`, `AGENTS.md` or a nested copy, before a PR is opened. Finds three kinds of candidate: *Stale* (a path, script or identifier the branch renamed or removed), *Missing* (a convention the branch introduced, cited from the diff) and *Misplaced* (ticket-level detail in the always-loaded file). Missing and Misplaced must pass a three-part gate (applies to future tasks, nothing else teaches it, agents get it wrong without it) with the answers in the finding; a ticket's business rule never passes, even when a section of the file already lists earlier tickets. Reports `Update recommended (N findings)` or `No update needed` with a unified diff per finding, edits only the source file (symlinks and `@AGENTS.md` imports resolved), never touches managed blocks, and writes only with `--apply`.
- `update-agent-docs` helper: `scripts/refs.mjs` lists the instruction files, their source and managed blocks, and checks every backticked path, package script and identifier against the merge base and the working tree, separating references the branch broke (with the rename target) from those already broken.

### Changed

- `review-work`: the *Documentation* criterion leaves agent instruction files to `update-agent-docs`.

## 0.5.1 — 2026-11-07

### Fixed

- `cleanup-dependabot`: re-extracting a transitive dependency now goes through `resolutions` (raise the `**/<pkg>` floor, or create the entry) followed by `yarn install`, and `package.json` may change only in `resolutions`. The previous instruction either added the package to `dependencies` or left the version unchanged, depending on whether the entry existed.
- `cleanup-dependabot`: the target version and the version `yarn.lock` resolved are now compared explicitly with the ranges the parents declare, because `resolutions` forces a version outside them with no warning. A version outside a range stops the re-extraction and is reported as a change in the parent.
- `cleanup-dependabot`: step 5 runs `covered <pkg> <version> HEAD` after the commit. It reads the committed lock, so running it earlier reported `NOT covered` after a correct bump.

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
