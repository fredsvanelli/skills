---
description: Create, change or delete the contexts of the role registry and their cases, then mark the runbooks the change reaches for review
argument-hint: "[name]"
disable-model-invocation: true
---

# Manage the contexts

Arguments: `$ARGUMENTS`

## Parameters

| Parameter | Use |
|---|---|
| `[name]` | the context to change. Without it, the command lists the contexts and asks which one, or offers to create one |

Examples: `/runbooks:roles:manage-contexts`, `/runbooks:roles:manage-contexts client-access`.

Edits `<paths.runbooks>/roles.json` and, for a rename or a delete, the runbooks and their `+<case>` fixture folders. Marks affected runbooks with `review`. A context is a question about the record that changes what a role may do on some keys, and a case is one answer to it. Read first: `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/config.md`, "Roles", and `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/format.md`, "Review". Commit policy: `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/commits.md`.

Run `git status --porcelain` now and keep the list for the commit step.

## 1. Load the registry

1. Read `docs/runbooks/runbooks.config.json`. When it is missing, offer `/runbooks:setup` and stop. When `roles.enabled` is not true, say that role tracking is off, offer `/runbooks:settings roles`, and stop.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" contexts` and show the table: context, description, keys, cases and runbook count. A registry with no contexts has nothing to show. Say so and go on, because step 2 creates the first one.
3. Read `roles.json`. Keep `version`, `actions`, `contexts` and each role's entries on the keys of a context.
4. With `[name]`, check that the context exists. A name the registry does not have gets the table from item 2, and the user can pick one or create it.

Done when the user has seen the contexts and you hold the registry.

## 2. Ask what changes

Ask with `AskUserQuestion`, in rounds of four. First ask which kind of change:

- create a context;
- add or remove a key of a context;
- add, rename or delete a case;
- change the description of a context;
- delete a context.

"Other" ends the loop. Repeat until the user has nothing more to change. Then ask the details of each kind:

- Create a context. Ask the name (kebab-case, not used by another context), the description (one line, the question about the record), the keys and the cases. Offer the keys of `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" list --json` and of the matrix, as `<capability>/<feature>` or `<capability>/*`. Do not offer a key that already belongs to another context, because a key belongs to one context. Ask for at least two cases. Each case has a kebab-case name, unique across every context, and one sentence that says which record it describes.
- Add a key. Offer the keys that no context lists. Check that the key does not belong to another context through a `<capability>/*` entry.
- Remove a key. Offer the context's keys. Say that a role's map on that key must become a list, and ask which case's actions the list keeps, as for a deleted context below.
- Add a case. Ask the name and the sentence. Say that a role with a map on a key of the context has no access in the new case until the user runs `/runbooks:permissions:manage` for it.
- Rename a case. Ask the new name. The rename runs through `roles.json`, the runbooks and the `+<case>` fixture folders in one write.
- Delete a case. Say that the case leaves every `cases` list, `Cases:` line and role line, and that the entry of every role map on the context loses it. The loader warns about a context with fewer than two cases: when the delete would leave fewer, say so and ask whether to delete the whole context instead.
- Change the description. Ask the new line.
- Delete a context. Name the roles that have a map on a key of the context. For each one, ask which case's actions the plain list keeps, with the cases as options.

The first context changes a file at `"version": 1` to `"version": 2`. When the file loses its last context, set `"version": 1` again and drop the empty `contexts` key.

Done when you hold every change, as old value and new value per context, key, case or description.

## 3. Show the diff

Show the diff of `roles.json`. Keep the file's key order, with `version` first and `contexts` after `actions`.

For a rename or a delete, also run the matching subcommand without `--write`, and show what it changes in the runbooks and the fixture folders:

- `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" rename-case <from> <to>`
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" delete-case <name>`
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" delete-context <name>`

They are dry runs without `--write`. They edit runbooks and move `+<case>` folders, and never `roles.json`. `rename-case` refuses a new name that is already a case. `delete-case` skips a runbook whose `cases` lists only that case, or that has a step running only in it, and does not write it. When the dry run skips any runbook, stop before any write: tell the user which runbooks and why, say that they need another case first (or `/runbooks:update <id>`), and end the step without writing. A delete leaves the `+<case>` folders in place and lists them with `to: null`; step 8 deals with them. `delete-context` removes the `cases` key from the runbooks.

For a removed key, no subcommand runs, so its runbooks keep `cases`, `Cases:` lines and case role lines. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" contexts --affected <name> --key <key>` now, before the write, and show the runbooks. After the write the key is no longer in the context and the command would not list them.

For a new context, a new key or a new case, no subcommand runs. `/runbooks:update` later gives the runbooks it reaches their `cases`, Preconditions and role lines.

Done when the user has seen the diff and, for a rename or a delete, the dry run.

## 4. Write

Ask whether to write, once. Write only after a yes; on a no, write nothing and stop.

On a yes, in this order:

1. The subcommand again with `--write`, when step 3 ran one.
2. `roles.json`.

Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" roles`. When it reports a registry error, restore every written file with `git checkout -- <paths>` after telling the user, and stop. Moved fixture folders go back with `git mv` in the other direction, or with `git checkout -- <paths>` when they were tracked.

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" list --json` too. Show the user each runbook that gains a problem after a rename or a delete. After a key removal, the runbooks from step 3 report loader problems (`cases needs a context`, and a role line with a case that has no context) until `/runbooks:update` clears them.

Done when the subcommand and `roles.json` are written and the script loads the registry.

## 5. Find and mark the affected runbooks

- A new context, or a key added to one, gives the reason `context-created`. The runbooks it reaches now run per case and need `cases`, a Preconditions `Cases:` list and case role lines:

  `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" contexts --affected <name> [--key <key>]`

  Add `--key` for a key added to an existing context.
- A new case gives the reason `case-created`. The same command lists its runbooks, which need the case's Preconditions line and role lines.
- A deleted context, or a key removed from a context, gives `role-permissions` for each role whose map became a list. A key removal passes `--key <key>` and a `--change` text such as `vip-outside kept: edit removed`. For each role that had a map and each key of the context (or the removed key), compare the effective actions of each case before the write with the list that remains. Where they differ, run:

  `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" roles --affected --role <role> --key <key>`

  The role's list is in `roles.json` by now, so the command lists the runbooks of the key.
- A renamed case, a deleted case and a changed description mark nothing. The subcommand already rewrote the runbooks.
- A removed key marks only the `role-permissions` entries above. The runbooks from step 3 still hold `cases`, `Cases:` lines and case role lines, and step 8 offers `/runbooks:update` for each.

An unknown name makes `contexts --affected` exit 2 with `no context "<name>"`. Show the message and check the name.

Show the runbooks grouped by reason, with the key in one line. When no runbook is reached, say so and go to step 6.

Done when the user has seen every group.

Then ask with `AskUserQuestion`: mark all, mark none, or pick some. On "pick some", ask which runbooks, multi-select in rounds of four, each with its keys in the label.

Build the command for the chosen runbooks:

- `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" mark-review <id...> --reason context-created --context <name>`
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" mark-review <id...> --reason case-created --case <name>`
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" mark-review <id...> --reason role-permissions --role <role> --key <key> --change "<one line>"`

Run each without `--write` first, show what it would add to each runbook, and ask whether to write. On a yes, run it again with `--write`.

Done when each chosen runbook has its entry, or the user chose none.

## 6. Show the change

Print, before any commit question:

- one line per change: the context, key, case or description, with old value and new value;
- for a rename or a delete: the runbooks rewritten, the runbooks the script skipped, and the fixture folders moved or left;
- for a deleted context: per role, the case whose actions the list kept;
- the runbooks marked, with the reason and the context, case or key, and the number left unmarked;
- the command that resolves each review: `/runbooks:update <id>`.

Done when the user has seen this summary.

## 7. Commit

Commit `roles.json`, the edited runbooks and the moved fixture folders by the `runbooks` policy. Ask an `ask` question only after the summary from step 6 is on screen; the question names the files and the message and does not repeat the summary.

Write in the config `language`.

Done when the user has seen the diff before the write and the summary before any commit question.

## 8. Close

Give the commit outcome: the short sha, or the paths left uncommitted. Then:

- offer `/runbooks:update <id>` for each runbook marked for review, which writes `cases`, the Preconditions lines and the role lines, and clears the review;
- after a case or context delete, list the `+<case>` folders left behind, and give the command the user can run to remove them: `git rm -r <folder>`, or a plain delete for untracked files;
- after a key removal, offer `/runbooks:update <id>` for each runbook listed in step 3, to drop `cases`, the `Cases:` lines and the case role lines, and say that they show loader problems until then;
- after a new case, say that `/runbooks:permissions:manage <role>` gives each role its actions in it.
