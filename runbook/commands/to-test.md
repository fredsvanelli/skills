---
description: Write or adopt the test script of a runbook, in the project's test library for its surface
argument-hint: "<id> [--out path]"
disable-model-invocation: true
---

# Runbook to test script

Arguments: `$ARGUMENTS`

## Parameters

| Parameter | Use |
|---|---|
| `<id>` | required: the runbook to script (`billing.issue-invoice`) |
| `--out path` | where to write a new script. Default: `<tests.<surface>.dir>/<capability>/<flow>.runbook.<ext>`, with the extension and naming of the project's tests (`.spec.ts`, `.cy.ts`, `.test.ts`, `Test.php`) |

Examples: `/runbook:to-test billing.issue-invoice`, `/runbook:to-test billing.create-invoice --out tests/Feature/Runbooks/CreateInvoiceTest.php`.

Read first: `${CLAUDE_PLUGIN_ROOT}/skills/runbook/references/format.md` ("Scripts of api runbooks").

The runbook is the source of truth. A script changes to match the runbook; the runbook changes only when the user says it is the one that is wrong, and then through `/runbook:update`.

`run` also follows this file for an `api` runbook whose script is missing or out of sync. Then it skips item 6 (its own execution is that run) and items 9 to 11 (its commit covers the script).

Run `git status --porcelain` now and keep the list for the commit step.

1. **Target.** A `placeholder` has no steps; stop and offer `/runbook:create --from placeholder <id>`. Read `tests.<surface>` for the runbook's `surface`. When it is missing, stop and offer `/runbook:setup` to pick a test library for that surface.
2. **Find existing tests.** A file in `scripts` that already has tests named with this runbook's step ids is an adopted script: it is the target, edited, never regenerated from scratch. A file in `scripts` with no such test is a candidate (from `/runbook:map`) and goes to item 3. When `scripts` has no adopted script, also search `tests.<surface>.dir` (in `tests.<surface>.root`) for tests of the same flow: the runbook's `covers.entries` (paths and methods of its endpoints, routes of its pages), the code those entries live in, and the capability and flow words. Keep the files whose tests exercise what the steps prove.
3. **Adopt or write.** For each candidate file, propose a mapping, one line per existing test: the step it proves, "kept, new Sxx beside it" (item 5), or "not a step". Ask with `AskUserQuestion`, per file: adopt it (recommended when it maps to at least one step), or write a new file and leave it alone. With no candidate, or when every one is declined, write a new file at the default path or `--out`.
4. **Conventions.** Read the framework's config (`playwright.config.*`, `cypress.config.*`, `jest.config.*`, `vitest.config.*`, `phpunit.xml`), two or three tests closest to the runbook's capability, and the fixtures and helpers they import (login, i18n, factories, test data). For `api`, also read the "API scripts" section of the agents block. Follow them. When tests read UI text from message files, read expected text the same way instead of copying the string.
5. **Write or edit.**
   - `ui`, Playwright: one `test.describe('<title>')` with one test that walks the steps in run order, one `test.step('S01 <step title>', ...)` per step, an assertion for each Expected, and the login the project's helpers provide.
   - `ui`, Cypress: one `describe('<title>')` with one `it` that walks the steps in run order, a `cy.log('S01 <step title>')` before each step, an assertion for each Expected.
   - `api`: one test per step, its name starting with the step id (`S01 <step title>`, or `test_s01_<title>` / `testS01<Title>` where names cannot have spaces, following the file's style). Each test builds its own state, repeating the parent's call when it builds on it, because isolation stays per test; `Parents:` decide the result, not the order of execution. Assert in the order of "What a step can verify": status and body, then the read-back call, then fakes or the framework's database assertion.
   - Adopted file: rename each mapped test so it starts with its step id, add the tests for steps that have none, and leave every unmapped test untouched. When a mapped test asserts something other than its step's Expected, show both and ask which is right: the script is edited to match the runbook, or the user runs `/runbook:update` and this command afterwards.
   - A mapped test that asserts more than its step (other records, other state), or checks through the database what the step reads back through an endpoint, is not renamed or trimmed: it stays untouched and unprefixed, and a new `Sxx` test for the step goes next to it. The project keeps every assertion it had. In item 3's mapping, show it as "kept, new Sxx beside it".
   - Comment line: `Runbook <id> (<runbook path>). Change the runbook first, then /runbook:to-test <id>.`, in the language's comment syntax. It is the first line of a new file; in an adopted file, it goes right above the first runbook test.
   - Never weaken an assertion so the app passes.
6. **Run once** with `tests.<surface>.command` limited to the script (`{files}` = the script, `{junit}` = `.runbook/junit/to-test-<id>.xml`), and show the result. For `api`, read it with `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbook.mjs" junit <id> --file <junit>`, and confirm it lists no step with no test and no test for a missing step. When it fails, compare with the runbook's last report: a script mistake (selector, timing, import, helper, fixture) gets fixed here; an app failure is a finding to report, not something to code around.
7. **Record.** `scripts:` in the runbook frontmatter lists the adopted and new scripts. A candidate the user declined in item 3 leaves the list.
8. **Leave CI alone.** CI jobs, gates and test allowlists are the project's decision; note any that would need the new file.
9. **Show the script.** Before any commit question, print the summary in the conversation: the script path (new or adopted); for an adopted file, the mapping test → step and the tests left untouched; one line per step with the test that covers it; the divergences settled in item 5 and how; the result of the run in item 6 (with each failing step and its error); the `scripts:` change in the runbook; and the CI files from item 8.
10. **Commit.** Commit the script and the runbook change together by the `runbooks` policy. Ask an `ask` question only after the summary from item 9 is on screen; the question names the files and the message and does not repeat the summary.
11. **Close.** Give the commit outcome: the short sha, or the paths left uncommitted.

Done when the script exists, has one runbook test per step for `api` (one `test.step` or `cy.log` per step for `ui`), ran once with a reported result, the runbook lists it, and the user has seen the summary before any commit question.
