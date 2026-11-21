# fredsvanelli/skills

Skills and plugins for Claude Code and OpenAI Codex: `runbooks` (UAT runbooks as a project's verified knowledge base) and `utils` (repository housekeeping, PR descriptions, PR ratings, agent-doc checks). `pmkit` is listed in the Claude marketplace but lives in its own repository. See `README.md` for installation.

## Development Workflow: SPEC-SS

Every task that changes application code goes through the six steps below, in order: **S**pecify (Brainstorm, then Interview), **P**lan, **E**xecute, **C**heck, **S**ecure, **S**hip. A step starts only when the step before it meets its "Done when". Start each step by saying its name in one line (`SPEC-SS: Interview`), so a skipped step is visible.

A small task gets a short design doc and a short plan, never a skipped step. Skip a step only when the user names that step and says to skip it. Time pressure, a one-line fix, "keep it moving" or "open the PR" are not that permission: they mean go through the remaining steps quickly. When you notice an earlier step was skipped, go back and do it before going on. Code already written without a failing test first can't be made test-first: say so in the PR.

| Step | Do | Done when |
|---|---|---|
| **Brainstorm** | Read the issue (`SKL-N`): `/pmkit:issues:work <id>` claims it and creates the branch. Invoke `superpowers:brainstorming` with the issue's context, scope and acceptance criteria. For a bug, find the root cause with `superpowers:systematic-debugging` first, and put it in the design. Answer factual questions from the code, not by asking the user. | The design doc is written to `docs/superpowers/specs/YYYY-MM-DD-<id>-<slug>-design.md` and committed. |
| **Interview** | Invoke `mattpocock-skills:grilling` with `mattpocock-skills:domain-modeling` on the design doc file from Brainstorm (this is what `/grill-with-docs` does). Check the design against the issue, the plugin's `CONTEXT.md` (today `runbooks/CONTEXT.md`) and the ADRs in `docs/adr/`. | The design doc is updated with the answers; new terms are in the plugin's `CONTEXT.md` (today `runbooks/CONTEXT.md`) and hard-to-reverse decisions are ADRs; the user approves the doc. |
| **P Plan** | Invoke `superpowers:writing-plans` on the approved design. | The plan is in `docs/superpowers/plans/`, with the design's file name minus `-design`. |
| **E Execute** | Test-driven (`superpowers:test-driven-development`): a failing test first, then the code. Small tasks: `superpowers:executing-plans`. Medium and larger: `superpowers:subagent-driven-development`. | Every plan task is done, and the tests, lint and type check pass. |
| **C Check** | Create or update the project's E2E test of every flow the work changes, then run the project's E2E tests of every flow the work touched. No E2E tool is chosen yet: ask the user before writing the first test script. | Every affected flow test passes. |
| **S Secure** | Invoke `ponytail:ponytail-review` on the branch diff (over-engineering), then `utils:review-work --base main` on the branch (spec match, tests, security, complexity, error handling, performance, compatibility, docs). A finding that changes behavior gets a failing test before its fix: a flow test step when a user can see the behavior, a unit test otherwise. Then run the affected flow tests again. Last, invoke `utils:update-agent-docs --base main` and apply the edits the user accepts to this file. | Every finding is fixed, or listed as open for the PR description. `utils:update-agent-docs` reported "No update needed", or its accepted edits are in. |
| **S Ship** | Run `npm --prefix runbooks test` and `node --test "utils/**/*.test.mjs"` (the `node:test` unit suites; the project has no lint, type-check or build step yet). Invoke `superpowers:finishing-a-development-branch` and take its push-and-open-PR option, never a local merge. Open the PR against `main`, with a body from `utils:generate-pr-description` that lists the findings left open in Secure. Move the issue to review (`/pmkit:issues:move`), then watch CI with `gh pr checks`. | CI is green. Never merge without explicit user authorization. |

Rules for every step:

- Use `superpowers:verification-before-completion` before saying a step is done: run its check and read the output.
- Planning alone does not authorize implementation. Follow the execution scope the user asks for.
- A skill named here can be swapped for a plugin, skill or prompt that does the same job (update its name here when one is), but its step still runs. A tool being missing or uninvokable is a reason to use its replacement, not to skip the step.

| Thought | Reality |
|---|---|
| "It's a one-line fix, brainstorming and the interview are overkill" | A small fix gets a short design doc and a short interview. The interview is where a one-line fix turns out to be two. |
| "The skills are only recommendations" | The skill can be swapped. The step cannot. |
| "`/grill-with-docs` isn't available" | Invoke `mattpocock-skills:grilling` and `mattpocock-skills:domain-modeling`. |
| "Writing the design doc or plan after the code is ceremony" | Write them now. They record what was decided, and Interview can still find a gap before the PR. |
| "The user said open the PR / keep it moving" | Go faster through the remaining steps. That is not permission to skip one. |

### Skill handoffs that skip a step

These skills end by pointing at a later skill. In this project the next SPEC-SS step comes first:

| When this skill says | Do instead |
|---|---|
| `superpowers:brainstorming`: after approval, invoke `superpowers:writing-plans` | Interview, then P Plan |
| `superpowers:executing-plans` or `superpowers:subagent-driven-development`: use `superpowers:finishing-a-development-branch` | C Check, then S Secure, then S Ship |
| `/pmkit:issues:work` step 7 (propose a plan) and step 8 (implement) | Brainstorm through E |
| `/pmkit:issues:work` step 9 (deliver: open the PR, move to review) | Only in S Ship, after Check and Secure |

### Running slash commands

`/pmkit:*` and `/grill-with-docs` cannot be called through the Skill tool. To run `/pmkit:<cmd>`, invoke the `pmkit:pmkit` skill and follow the command file its table names. For `/grill-with-docs`, invoke `mattpocock-skills:grilling` and `mattpocock-skills:domain-modeling`.

## Tech stack

- Project type: Other
- What it is: Claude and Codex plugins
- Language: JavaScript (Node 18+, ES modules)
- Unit tests: Node's built-in test runner (`node --test`): `npm --prefix runbooks test` and `node --test "utils/**/*.test.mjs"`
- Not decided yet: E2E tests. Ask the user before choosing one.
