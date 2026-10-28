---
description: Read any document about who may do what (text, CSV, spreadsheet, JSON, PDF, image) and propose the roles, contexts and permissions it describes, merged into roles.json
argument-hint: "<file...> | <text> [--model inline|haiku|sonnet|opus|fable]"
disable-model-invocation: true
---

# Generate roles from a document

Arguments: `$ARGUMENTS`

## Parameters

| Parameter | Use |
|---|---|
| `<file...>` | one or more files, relative to the project root, in any format: plain text, Markdown, CSV, spreadsheet (`.xlsx`, `.xls`, `.ods`), JSON, YAML, PDF, Word, an image of a table |
| `<text>` | the rules typed in the arguments, as in `managers approve invoices, editors only create them` |
| `--model m` | force the model of the sub-agent this command launches: `inline` (the main session runs it), `haiku`, `sonnet`, `opus` or `fable` |

Examples: `/runbooks:roles:generate docs/access-matrix.xlsx`, `/runbooks:roles:generate specs/permissions.pdf specs/roles.md`, `/runbooks:roles:generate support agents see every ticket but only close their own`.

This file only dispatches. The procedure is in `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/instructions/roles/generate.md`. Dispatching follows `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/agents.md`: read it before step 3. It covers the model, the brief, the report, questions, calls, commits and a model that cannot launch.

Edits `<paths.runbooks>/roles.json` and marks affected runbooks with `review`. Commit policy: `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/commits.md`.

## Dispatch

1. Run `git status --porcelain` now and keep the list for the commit step.
2. Without arguments, ask for the source with `AskUserQuestion`: a file path or the rules as text, both typed in "Other". Put the answer in the brief as the arguments.
3. Follow "Dispatch steps" in `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/agents.md` with the command `roles:generate` and the instructions file `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/instructions/roles/generate.md`. The sub-agent asks the open points, the write decision and the review marks as questions. Relay them.
4. Print the `summary:` of the report as written, before any commit question.
5. **Commit.** Commit `roles.json` and the marked runbooks by the `runbooks` policy, staging by path the files the report lists in `files:`. The proposal and the converted copies of the source are not committed. Ask an `ask` question only after the summary from step 4 is on screen; the question names the files and the message and does not repeat the summary.
6. **Close.** Give the commit outcome: the short sha, or the paths left uncommitted. Then:

   - offer `/runbooks:update <id>` for each runbook marked for review, which writes the role lines and cases and clears the review;
   - with `ui` in the stack, list the new roles with no account: `ui` runs give them `no-account` until `/runbooks:roles:update <name>` adds the login's env var names;
   - offer the commands for the changes the proposal left to them (`/runbooks:roles:update`, `/runbooks:roles:delete`, `/runbooks:contexts:update`, `/runbooks:contexts:delete`);
   - offer `/runbooks:permissions:manage <role>` to settle the keys still marked `guess`.

Done when the user has seen the summary before any commit question.
