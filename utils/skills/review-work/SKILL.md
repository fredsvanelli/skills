---
name: review-work
description: "Rate a pull request's delivery from 0 to 10 per criterion (spec match, unit and e2e tests, security, cyclomatic complexity, tech debt, error handling, performance, conventions, scope, compatibility, docs) and overall, deducting a fixed amount per verified finding, then list a next step for every finding. Use when the user types /utils:review-work or asks to review, rate, score, grade or evaluate a PR or this branch's delivery."
argument-hint: "[<pr-number>] [--base <branch>] [--spec <path|url|ticket>]"
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
  - AskUserQuestion
---

# Review work

Before following this procedure, read [runtime setup](../../references/runtime.md). Resolve the plugin root from this file's real location and use the active host's tools and argument handling. Do this also when this entry is invoked directly.

Reads what the PR was supposed to deliver and what it actually delivers, then rates each
criterion from **0.0 to 10.0** (one decimal) with the evidence behind it. Read-only: it never
edits code, comments on the PR or pushes.

**Where it works:** the repository root, with `python3` and, for a PR, `gh` authenticated. Two
helpers do the mechanical part (no `jq`); run either with no arguments to see its usage:

```bash
G="${UTILS_PLUGIN_ROOT}/skills/review-work/scripts/gather.py"   # the delivery: PR, checks, threads, files, tests, specs, complexity
R="${UTILS_PLUGIN_ROOT}/skills/review-work/scripts/rate.py"     # the rates and the report, from the verified findings
```

Shell calls may start fresh: reassign `G` and `R` in each call (see runtime setup).

## Usage

```
/utils:review-work                   # the current branch's PR (or the branch alone, if no PR)
/utils:review-work 123
/utils:review-work --base main
/utils:review-work --spec docs/specs/checkout.md
/utils:review-work --spec ABC-123
```

| Flag | Effect |
|---|---|
| `<pr-number>` | PR to rate. Default: the open PR of the current branch (`gh pr view`) |
| `--base <branch>` | Base of the comparison. Default: the PR's base; without a PR, `develop` when `origin/develop` exists, else the default branch |
| `--spec <path\|url\|ticket>` | Extra source of truth for *Spec match*, added to what is found automatically |

## Step 1: Gather the delivery

```bash
G="${UTILS_PLUGIN_ROOT}/skills/review-work/scripts/gather.py"
python3 "$G" info [<pr-number>] [--base <branch>] --diff        # one call: the facts, then the filtered diff
python3 "$G" info [<pr-number>] [--base <branch>] --template    # the findings file for Step 6, candidates filled in
python3 "$G" diff [<pr-number>] [--base <branch>] [<path>…]     # the diff alone, or only some files
```

`info` prints everything Steps 2–4 need, in sections: the PR (or, without one, the branch, its
merge base and whether uncommitted or untracked work is included), the commits, the CI checks
split into required and other with the failing and pending ones called out, the reviews
(`CHANGES_REQUESTED` with no later approval from the same reviewer, and the **unresolved**
review threads; resolved ones are settled and not listed), every changed file classified
(`code`, `test`, `e2e-test`, `style`, `markup`, `config`, `docs`, `asset`, `noise`, `other`)
with its additions and deletions, the test files next to each changed code file (named after
it, or referencing it), the spec sources, the PR body, the cyclomatic complexity of the changed
code, and **Candidates**: the findings the facts already suggest (failing checks, code with no
test, unresolved threads, complex functions, and markers found in the added lines: TODO/FIXME,
skipped tests, disabled lint rules, secret-looking literals, open CORS or disabled TLS checks).
A candidate is a lead, not a finding: Step 5 confirms or drops each one, and the diff still
needs reading for what no scan sees. `--diff` appends the filtered diff; use it unless the PR is
too large to read in one pass.

- A failing required check is a blocker. *no required checks reported* means the base has no
  required checks, not that they passed. Without a PR, CI is not consulted.
- Without a PR, the branch is compared with its merge base against `--base` (default
  `develop` when `origin/develop` exists, else the default branch), so commits, uncommitted and
  untracked work all count. Say so in the summary.

`diff` prints the diff without lockfiles, snapshots, build output and vendored code, which
drown the diff without adding evidence; untracked files appear as new files. It works for open
and merged PRs alike, including when the head branch was deleted. Judge dependency changes from
the manifest (`package.json`, `pyproject.toml`, `go.mod`…), and open a lockfile only when it
changed without its manifest (`diff <lockfile path>` prints it). When the filtered diff is
still too large to read in one pass, read it one file at a time with `diff <path>`, logic
files first and biggest first.

Read the changed files whole when a hunk is not enough to judge (a branch added in the middle
of a long function, a caller that now gets a new error).

## Step 2: Gather the expectation

*Spec match* is rated against what was asked, never against the PR's own description of
itself. The *Spec sources* and *PR body* sections of `info` list what exists; collect every
source, in this order:

1. `--spec`, when given.
2. Linked issues: `info` prints the title, body and comments of the closing issues and of the
   `#123` references in the body.
3. Ticket ids found in the branch, title, body or commits (`info` → *tickets*) → read them
   through the tracker's tools when the session has them (Linear, Jira, Plane…).
4. Spec, plan and acceptance-criteria files in the repo: `info` lists those touched by the
   diff (`docs/`, `specs/`, `.planning/`, `PLAN.md`, `SPEC.md`, `*-PLAN.md`, ADRs) and those
   named after a ticket; look yourself for ones named after the feature. Read them whole.
5. The PR body, only for criteria it states explicitly (a checklist, "Acceptance criteria").

Turn them into a numbered list of requirements, then mark each one **done / partial / missing /
contradicted** with the file and line that proves it. That list is the evidence for the rate.

When sources 1–4 find nothing:

- The PR body states the intent (what changes and why) → rate against it without asking, and
  start the summary with *no spec; rated against the PR body*.
- The body is empty or only restates the title → ask the user once for the spec
  (`AskUserQuestion`). If there is none, rate against the title and say *no spec found* in the
  summary.

## Step 3: Decide what applies

Not every criterion fits every PR: a button color change has no logic to unit test, no input to
secure and no function to measure. Rating it anyway inflates or punishes the PR for nothing.
`info` classifies each changed file by extension and path; correct it from the diff when it is
wrong (a `.json` the code branches on is logic, a `.ts` holding only constants is not), then
keep only the criteria the diff triggers:

| Criterion | Applies when the diff… | Typically N/A for |
|---|---|---|
| Spec match | always | — |
| Scope & size | always | — |
| Readability & conventions | changes any code, styles included | docs, assets, lockfiles only |
| Tech debt | changes any code, styles included | docs, assets, lockfiles only |
| Tests (unit) | adds or changes logic: branches, calculations, data transformation, state | styles, copy, assets, constant values |
| Tests (e2e) | changes a user flow: navigation, forms, interactions, behavior an API client sees. A purely visual change applies only when the project has visual-regression or screenshot tests | styles, copy, internal refactors with no visible effect |
| Security | touches input, auth, permissions, data access, network calls, file/shell, secrets or config, dependencies | styles, copy, docs |
| Cyclomatic complexity | adds or changes functions with control flow | styles, markup, config, data files |
| Error handling & edge cases | adds or changes code that can fail: I/O, parsing, user input, external calls | styles, copy, pure markup |
| Performance | changes a runtime path that scales with data or traffic: queries, loops, list rendering, payloads, a new dependency in the bundle | styles, copy, config values |
| Backward compatibility | changes a public API, schema, migration, config or env keys, event payloads, URLs, CLI flags | internal code with no external consumer |
| Documentation | changes behavior, setup, config or a public API | visual tweaks, internal refactors |

- Decide from the **diff**, not from the PR title. A "change button color" PR that also edits
  the click handler gets the logic criteria back.
- Small does not mean N/A: a color change that hardcodes `#3b82f6` where the project uses
  design tokens is a real *Readability & conventions* and *Tech debt* finding.
- **Config files** (JSON, YAML, TOML, manifests, CI workflows, env examples) count as code for
  *Readability & conventions* and *Tech debt*. They trigger *Security* when they change sources,
  permissions, secrets or dependencies; *Backward compatibility* when something outside the repo
  reads them; *Documentation* when they change setup or behavior. They trigger tests only when
  the project's own code branches on the changed value: a value read by an external tool (a
  plugin marketplace, a CI runner, a deploy platform) has no logic in the repo to test, so both
  test criteria are N/A.
- Mixed PRs: a criterion applies if any changed file triggers it, and it is rated on those
  files only.
- Skip Step 4's measurement for N/A criteria: no complexity run on a CSS diff.

## Step 4: Measure

Facts first, judgment second, only for the criteria that apply. Use what the project already
has; never install a tool.

- **Tests**: the *Tests* section of `info` maps each changed code file to the test files named
  after it (*by name*) or mentioning it (*by ref*) and says whether they changed; *none*, or a
  test left unchanged, is a candidate finding. Read the tests that changed: whether they assert the new behavior or only run it.
  CI status is in the *Checks* section. For each guard, branch and error path the diff adds,
  find the test that asserts it: none is a candidate finding. `info` names the e2e suites it
  finds (Playwright, Cypress, `e2e/`, `tests/integration`…); look yourself for ones it does not
  recognise (runbooks…). Check whether the suite drives the changed flows through their entry
  point (a browser, an HTTP request, a
  spawned CLI process); tests of the flow's helpers or text checks of its instructions are not
  e2e. Do not run the suites: CI is the source; no CI → say *not verified*.
- **Commands**: to check a claim in the PR body, you may run a read-only validator it cites
  that finishes in seconds (`claude plugin validate .`, a type check, a linter), on the PR's
  head commit exported to a temp dir (`git archive <sha> | tar -x -C "$(mktemp -d)"`), never
  on the working tree. Never run test suites, builds, installs or anything that writes to the
  repo or calls the network.
- **Cyclomatic complexity**: the *Complexity* section of `info` runs `lizard` (any language),
  `radon` (Python) or `gocyclo` (Go) when one is installed and lists every function of the
  changed code files at CCN ≥ 11, with its CCN in the base and whether the diff touched it.
  Without a tool (or with `eslint --rule 'complexity: [warn, 10]'` when the project has it),
  count decision points (`if`, `else if`, `case`, loops, `&&`, `||`, `?:`, `catch`) + 1 per
  added or changed function, and compare with the base when a function grew.
- **Security**: secrets in the diff, input reaching SQL/shell/HTML/paths/URLs without
  validation, auth or permission checks on new routes, new dependencies (known to be abandoned
  or vulnerable; run the project's `npm audit`/`pip-audit` only if already set up), logging of
  sensitive data, unsafe defaults (CORS `*`, disabled TLS checks).
- **Tech debt**: TODO/FIXME/HACK added, duplicated logic that already exists elsewhere in the
  repo, disabled lint rules or skipped tests, dead code, workarounds without a reason. The
  markers (TODO, skip, disabled rule, secret-looking literal, unsafe default) are already in
  *Candidates*; look yourself for what no regex finds: duplication, dead code, workarounds.
- **CI**: a failing required check (*Checks → required* in `info`) is a blocker. A failing
  check that is not required is a major finding in the criterion it covers: a test job in
  *Tests*, lint in *Readability & conventions*, an audit in *Security*. Pending checks or no
  CI → *not verified*.
- **Review threads**: each unresolved thread and each `CHANGES_REQUESTED` review with no later
  approval from the same reviewer (both in the *Reviews* section of `info`) is a candidate
  finding in the criterion it is about. Verify
  it in Step 5 like your own; a reviewer's opinion alone deducts nothing.
- **Conflicts**: `mergeable: CONFLICTING` lowers no rate. Report it in one line below the table.

## Step 5: Verify findings

Start from the file `info --template` wrote (Step 6): the *Candidates* are already there as
findings, with `severity` `?` where the table needs your judgment and `next_step` empty. Add
your own candidates from the diff in the same shape (criterion, severity, `file:line`, one
sentence, the action that fixes it). Then confirm each one before it can deduct anything:

- The `file:line` is in the diff, or in code the diff calls or changes the behavior of. Old
  problems the diff does not touch are out: rate the PR, not the codebase. Debt the diff
  extends is in.
- Reread the code around the line, and the callers or tests that could refute the finding (a
  guard one level up, a test in another file, a validation in the middleware). Refuted → drop
  it silently.
- Confirming it needs something you cannot do from the code (running the app, CI that never
  ran, a production config) → it deducts nothing and goes in the *Not verified* line of the
  report.
- **One finding, one criterion**: a cause counts once, in the criterion whose fix removes it.
  Duplicated logic is *Tech debt*, not also *Readability*. A 25-branch function is
  *Cyclomatic complexity*, not also *Readability*.
- One finding per unit: per requirement, per function, per flow, per endpoint. Five untested
  functions are five findings, not one.
- For *Tests (e2e)*, the unit is the changed code path, not each caller that reaches it. Three
  commands that stop on the same uncovered check are one finding, citing all three; three
  commands with their own uncovered logic are three.

## Step 6: Rate

Every applicable criterion starts at **10.0** and loses a fixed amount per verified finding:

| Severity | Deducts | Use for |
|---|---|---|
| Blocker | 6.0 | exploitable vulnerability, a core requirement missing or contradicted, data loss, a failing required CI check |
| Major | 3.0 | the *Major* column below |
| Minor | 1.0 | the *Minor* column below |
| Nit | 0.5 | style or naming points that do not change how the code reads or behaves |

Rate = `max(0.0, 10.0 − sum of deductions)`, one decimal. No finding → 10.0. `rate.py` computes
it (below); the summary cites the findings that cost the most (file, function, requirement
number).

| Criterion | Major | Minor |
|---|---|---|
| Spec match | secondary requirement missing, core requirement partial | secondary requirement partial |
| Tests (unit) | changed function with logic and no unit test, or a test that runs it without asserting the new behavior | new branch or error path not asserted |
| Tests (e2e) | changed user flow that no test exercises at all | flow driven through its entry point only on the happy path; or covered only through its helpers or text checks, not its entry point; or only by an existing e2e by luck |
| Security | missing auth or permission check, unvalidated input reaching SQL/shell/HTML/paths/URLs, sensitive data logged, unsafe default | hardening gap: missing header, overly broad scope, abandoned dependency |
| Cyclomatic complexity | changed function > 20, or nesting that hides the logic | a function the diff adds or makes more complex, landing at 11–20. A function the diff made simpler never counts |
| Tech debt | duplicated logic, skipped test or disabled rule with no reason | TODO/FIXME/HACK added, dead code, workaround with its reason stated |
| Error handling & edge cases | error swallowed, crash on bad input | empty, limit or concurrent case ignored |
| Performance | N+1, unbounded query or loop, blocking I/O on a hot path | a hot path slower in a bounded way, avoidable payload or bundle growth |
| Readability & conventions | ignores a project convention throughout the change | a local drift from project patterns: a name, an idiom, a hardcoded value where tokens exist |
| Scope & size | unrelated refactor mixed in, too big to review in one sitting | an unrelated change |
| Backward compatibility | undocumented breaking change to API, schema, config or env keys | documented breaking change with no migration path |
| Documentation | behavior or setup changed with nothing updated | partially updated: README, changelog, docs or env example missed |

Rules:

- **Severity comes from the tables above**, never from how reasonable the cause seems. A reason
  given in the spec, an ADR or the PR body lowers a finding only where the table says so
  (*workaround with its reason stated*, *documented breaking change*). Duplicated logic is
  Major even when the spec chose to keep it.
- **N/A** comes only from Step 3. Once a criterion applies, a gap is a finding, never N/A:
  logic with no unit test, a changed flow with no e2e, or a project with no test
  infrastructure at all. N/A items are out of the overall.
- **Overall** = weighted average of the applicable items, one decimal. Weights: Spec match 3,
  Security 2, Tests (unit) 2, Tests (e2e) 1.5, every other item 1.
- **Blocker caps overall at 4.0**. Name the blocker below the table.
- **Never compute in your head.** The findings file is JSON: title, `lang`, the N/A criteria of
  Step 3 with their reason, an optional one-line summary per criterion, the findings as
  criterion / severity / where / summary / next step, the *Not verified* lines and the base the
  PR conflicts with. `info --template` writes it with the candidates, the pending checks and
  the conflict filled in; edit it (verify, drop, add, set `lang` and `na`) and run:

  ```bash
  G="${UTILS_PLUGIN_ROOT}/skills/review-work/scripts/gather.py"
  R="${UTILS_PLUGIN_ROOT}/skills/review-work/scripts/rate.py"
  F="$(mktemp -d)/findings.json"     # write the findings here, never inside the repository
  python3 "$G" info [<pr-number>] --template > "$F"
  # … edit "$F" …
  python3 "$R" report "$F"
  ```

  It applies the deductions, the floor, the weights and the cap, prints the Step 7 report on
  stdout and the arithmetic on stderr, and rejects the file (exit 1) when a finding sits in an
  N/A criterion, names an unknown criterion or severity (a `?` left from the template), lacks a
  next step, or repeats a cause already counted in another criterion. Fix the findings, never
  the printed numbers.

## Step 7: Report

`rate.py report` prints the report below. Write it in the project's predominant language,
headings and column names included. Detect it from the last merged PRs (`gh pr list --state
merged --limit 5 --json title,body`), the README and the commit messages, and set `lang` in the
findings file: `en` and `pt` (Portuguese columns: `Item | Resumo | Nota`) come out translated;
for any other language, write the summaries and next steps in it and translate the fixed text
yourself before printing.

```markdown
## <PR title> (#<n>)

| | Item | Summary | Rate |
|---|---|---|---|
| ⚠️ | Spec match | 5 of 6 requirements done; #4 (export CSV) missing | 7.5 |
| ❌ | Tests (unit) | `parseOrder` covered; error path of `chargeCard` not asserted | 6.0 |
| ❌ | Tests (e2e) | No e2e for the new checkout step | 2.0 |
| ✅ | Security | no finding | 10.0 |
| | … | … | … |
| ❌ | **Overall** | | **6.4** |

Blocker: <only when there is one, with the cap applied>.

### Next steps

| Severity | Item | Where | Next step |
|---|---|---|---|
| Major | Tests (e2e) | `app/checkout/review/page.tsx` | Add a Playwright spec for `/checkout/review`: happy path and declined card |
```

- The first table lists only the applicable items, in rubric order, each with a status icon in
  the first column: ✅ 9.0 and up, ⚠️ 7.0 to 8.9, ❌ below 7.0 (the overall row too). Below it, one line names
  the N/A items and why, e.g. *Not applicable: Tests (unit), Tests (e2e), Security, Cyclomatic
  complexity, Error handling, Performance, Backward compatibility, Documentation — style-only
  change (`Button.module.css`)*.
- Then, only when they exist, one line each: *Not verified* (findings from Step 5 that need a
  run or a check you could not do, and why), *Conflicts with `<base>`* (rebase before merge).
- A trivial PR gets a short report: four rows is a complete rating, not a lazy one.
- *Next steps* lists **every verified finding**, blockers first, then major, minor and nit,
  with a concrete action: which file, which test, which check. "Improve tests" is not a next
  step. No finding → replace the table with one line saying so.
- Print the report in the chat only. Posting it on the PR is up to the user.
