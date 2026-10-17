---
description: Check that runbooks still match the code (no browser)
argument-hint: "<id> | --capability x | --all [--fix]"
disable-model-invocation: true
---

# Audit runbooks against the code

Arguments: `$ARGUMENTS`

Read first: `${CLAUDE_PLUGIN_ROOT}/skills/runbook/references/format.md`.

Run `git status --porcelain` now and keep the list for the commit step.

## 1. Select

`node "${CLAUDE_PLUGIN_ROOT}/scripts/runbook.mjs" list --json` filtered to the id, the capability, or every non-deprecated runbook with `--all`. Invalid runbooks get `broken` with their problems.

## 2. Check

Run `... coverage --json` once and read its `orphans`. Then, for each runbook, check every item below and record each finding with the step, the evidence (`file:line`) and the edit that would fix it:

| Check | Verdict when it fails |
|---|---|
| every `covers.entries` id exists (not in `orphans`) | `broken` |
| every `covers.requirements` id exists, when requirement sources are configured | `broken` |
| every `Parents:` names an existing step and the tree has no cycle | `broken` |
| every quoted Expected text exists in a `uiText` file; for text with interpolated values, its static part | `drift` |
| every `Page:` route still exists and the runbook's roles can still open it (route guards, navigation config) | `drift` |
| every control named in Actions still has that visible label | `drift` |
| every path in `sources` and `scripts` still exists | `drift` |

The runbook's verdict is the worst of its findings; none means `in-sync`.

## 3. Report

A table (runbook, verdict, findings count), then the findings per runbook. Print it in the chat; write no file.

## 4. Fix (with `--fix`)

Show the proposed edits as a diff per runbook and apply them after the user approves. An edited runbook keeps its `status`.

## 5. Show the fixes (with `--fix`)

Print the summary in the conversation before any commit question: a table with one row per applied fix (runbook, step, finding, the edit in one line), then the findings left unfixed with the reason, and the runbooks whose `last_run` now describes the old text.

## 6. Commit (with `--fix`)

Commit by the `runbooks` policy. Ask an `ask` question only after the summary from step 5 is on screen; the question names the files and the message and does not repeat the summary.

## 7. Close (with `--fix`)

Give the commit outcome: the short sha, or the paths left uncommitted. Offer `/fredsvanelli:runbook:run <id>` for each edited runbook.

Done when every selected runbook has a verdict and every finding names its evidence; with `--fix`, also when the user has seen the summary of the fixes before any commit question.
