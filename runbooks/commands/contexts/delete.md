---
description: Remove a context from the role registry and from its runbooks, turning each role's map on its keys into a list
argument-hint: "<name> [--model inline|haiku|sonnet|opus|fable]"
disable-model-invocation: true
---

# Delete a context

Arguments: `$ARGUMENTS`

## Parameters

| Parameter | Use |
|---|---|
| `<name>` | the context to delete. Without it, the command lists the contexts and asks which one |
| `--model m` | run this command in a sub-agent on that model: `inline` (the main session runs it, the default), `haiku`, `sonnet`, `opus` or `fable` |

Examples: `/runbooks:contexts:delete client-access`.

Removes the context from `<paths.runbooks>/roles.json` and its cases from the runbooks. Each role's map on a key of the context becomes a list. Marks the runbooks where a role's actions changed with `review`. Read first: `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/config.md`, "Roles", and `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/format.md`, "Review". Commit policy: `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/commits.md`.

Run `git status --porcelain` now and keep the list for the commit step.

## Model

With `--model` set to a value other than `inline`, follow "Dispatch steps" in `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/agents.md` with this file as the instructions file, and the sub-agent skips this section. Otherwise follow the file below as usual.

## 1. Load the context

1. Read `docs/runbooks/runbooks.config.json`. When it is missing, offer `/runbooks:setup` and stop. When `roles.enabled` is not true, say that role tracking is off, offer `/runbooks:settings roles`, and stop.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" contexts` and show the table. A registry with no contexts has nothing to delete. Say so and stop.
3. Without `<name>`, ask which context with `AskUserQuestion`. A name the registry does not have gets the same question.
4. Read `roles.json`. Keep `version`, `actions`, `contexts` and each role's entries on the keys of the context. For each role with a map on one of those keys, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" roles <role>` and keep its effective actions per key and case as the matrix before the change.

Done when you hold the context, the registry and the matrices.

## 2. Decide about the roles

Name the roles that have a map on a key of the context. For each one, ask with `AskUserQuestion`, in rounds of four, which case's actions the plain list keeps, with the cases as options. A role with a list on those keys keeps it and needs no question.

Remove the context from `contexts`. When the file loses its last context, set `"version": 1` again and drop the empty `contexts` key.

Done when you hold the list for each role and key.

## 3. Show the diff

Show the diff of `roles.json`. Keep the file's key order, with `version` first and `contexts` after `actions`.

Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" delete-context <name>` and show what it changes in the runbooks. It is a dry run without `--write`. It removes `cases`, the Preconditions `Cases:` lists, step `Cases:` lines and the case role lines from the runbooks of the context, and never edits `roles.json`. It leaves the `+<case>` folders in place and lists them with `to: null`; step 8 deals with them.

Done when the user has seen the diff and the dry run.

## 4. Write

Ask whether to write, once. Write only after a yes; on a no, write nothing and stop.

On a yes, in this order:

1. `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" delete-context <name> --write`.
2. `roles.json`.

Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" roles`. When it reports a registry error, restore every written file with `git checkout -- <paths>` after telling the user, and stop.

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" list --json` too, and show the user each runbook that gains a problem.

Done when the runbooks and `roles.json` are written and the script loads the registry.

## 5. Mark the runbooks

For each role that had a map and each key of the context, compare the effective actions of each case before the write with the list that remains. Where they differ, run:

`node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" roles --affected --role <role> --key <key>`

The role's list is in `roles.json` by now, so the command lists the runbooks of the key. Show them grouped by role, with the key in one line. When no runbook is reached, say so and go to step 6.

Ask with `AskUserQuestion`: mark all, mark none, or pick some. On "pick some", ask which runbooks, multi-select in rounds of four, each with its keys in the label. Then run, for the chosen ids:

`node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" mark-review <id...> --reason role-permissions --role <role> --key <key> --change "<one line>"`

The `--change` text names the case kept and what the other cases lose, such as `vip-team kept: edit removed in regular`. Run it without `--write` first, show what it would add to each runbook, and ask whether to write. On a yes, run it again with `--write`.

Done when each chosen runbook has its entry, or the user chose none.

## 6. Show the change

Print, before any commit question:

- the context deleted, with its keys and cases;
- per role, the case whose actions the list kept;
- the runbooks rewritten, and the fixture folders left;
- the runbooks marked, with the role and the key, and the number left unmarked;
- the command that resolves each review: `/runbooks:update <id>`.

Done when the user has seen this summary.

## 7. Commit

Commit `roles.json` and the edited runbooks by the `runbooks` policy. Ask an `ask` question only after the summary from step 6 is on screen; the question names the files and the message and does not repeat the summary.

Write in the config `language`.

Done when the user has seen the diff before the write and the summary before any commit question.

## 8. Close

Give the commit outcome: the short sha, or the paths left uncommitted. Then:

- offer `/runbooks:update <id>` for each runbook marked for review;
- list the `+<case>` folders left behind, and give the command the user can run to remove them: `git rm -r <folder>`, or a plain delete for untracked files.
