---
description: Turn a runbook into a Playwright spec in the project's E2E folder
argument-hint: "<id> [--out path]"
disable-model-invocation: true
---

# Runbook to Playwright spec

Arguments: `$ARGUMENTS`

Run `git status --porcelain` now and keep the list for the commit step.

1. **Target.** A `placeholder` has no steps; stop and offer `/runbook:create --from placeholder <id>`.  `--out` when given; else `<paths.e2e>/<capability>/<flow>.runbook.spec.<ts|js>`, matching the extension of the project's specs. When `paths.e2e` is `null`, ask: stop (recommended), or create `e2e/runbooks/` and tell the user Playwright must be installed and configured to pick it up.
2. **Conventions.** Read `playwright.config.*`, two or three existing specs closest to the runbook's capability, and the fixtures and helpers they import (login, i18n, test data). Follow them. When specs read UI text from message files, read expected text the same way instead of copying the string.
3. **Write.** One `test.describe('<title>')` with one test that walks the steps in run order, one `test.step('S01 <step title>', ...)` per step, an assertion for each Expected, and the login the project's helpers provide. First line: `// Generated from runbook <id> (<runbook path>). Change the runbook, then regenerate with /runbook:to-script <id>.`
4. **Run once** with the project's Playwright command limited to the file (for example `npx playwright test <file>`), and show the result. When it fails, compare with the runbook's last report: a spec mistake (selector, timing) gets fixed here; an app failure is a finding to report, not something to code around.
5. **Record.** Add the spec path to `scripts:` in the runbook frontmatter.
6. **Leave CI alone.** CI jobs, gates and E2E allowlists are the project's decision; note any that would need the new file.
7. **Show the script.** Before any commit question, print the summary in the conversation: the spec path, one line per `test.step` with the step it covers, the result of the run in item 4 (with each failing step and its error), the `scripts:` change in the runbook, and the CI files from item 6.
8. **Commit.** Commit the spec and the runbook change together by the `runbooks` policy. Ask an `ask` question only after the summary from item 7 is on screen; the question names the files and the message and does not repeat the summary.
9. **Close.** Give the commit outcome: the short sha, or the paths left uncommitted.

Done when the spec exists, ran once with a reported result, the runbook lists it, and the user has seen the summary before any commit question.
