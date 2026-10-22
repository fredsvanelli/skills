---
description: Register a new context of the role registry with its keys and cases, then mark the runbooks it reaches for review
argument-hint: "[name]"
disable-model-invocation: true
---

# Create a context

Arguments: `$ARGUMENTS`

## Parameters

| Parameter | Use |
|---|---|
| `[name]` | the new context, kebab-case and not used by another context. Without it, the command asks |

Examples: `/runbooks:contexts:create`, `/runbooks:contexts:create client-access`.

Adds the context to `<paths.runbooks>/roles.json` and marks the runbooks it reaches with `review`. A context is a question about the record that changes what a role may do on some keys, and a case is one answer to it. Read first: `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/config.md`, "Roles", and `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/format.md`, "Review". Commit policy: `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/commits.md`.

Run `git status --porcelain` now and keep the list for the commit step.

## 1. Load the registry

1. Read `docs/runbooks/runbooks.config.json`. When it is missing, offer `/runbooks:setup` and stop. When `roles.enabled` is not true, say that role tracking is off, offer `/runbooks:settings roles`, and stop.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" contexts` and show the table: context, description, keys, cases and runbook count. A registry with no contexts prints `No contexts.`
3. Read `roles.json`. Keep `version`, `actions`, `contexts` and the roles.
4. With `[name]`, check that no context has it. A name the registry already has gets `/runbooks:contexts:update <name>` as the command to change it, and the command stops.

Done when the user has seen the contexts and you hold the registry.

## 2. Ask about the context

Ask with `AskUserQuestion`, in rounds of four:

1. The name, when `$ARGUMENTS` has none. A name that is not kebab-case, or that another context has, is asked again with the reason.
2. The description: one line, the question about the record.
3. The keys. Offer the keys of `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" list --json` and of the matrix, as `<capability>/<feature>` or `<capability>/*`. Do not offer a key that already belongs to another context, directly or through a `<capability>/*` entry, because a key belongs to one context.
4. The cases, at least two. Each case has a kebab-case name, unique across every context, and one sentence that says which record it describes.

The first context changes a file at `"version": 1` to `"version": 2`.

Done when you hold the name, description, keys and cases.

## 3. Show the diff

Show the diff of `roles.json`. Keep the file's key order, with `version` first and `contexts` after `actions`.

No subcommand runs. The roles keep their entries on the new keys: a list gives the same actions in every case, so no role's access changes until `/runbooks:permissions:manage` gives it a map.

Done when the user has seen the diff.

## 4. Write

Ask whether to write, once. Write only after a yes; on a no, write nothing and stop.

On a yes, write `roles.json`. Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" roles`. When it reports a registry error, restore the file with `git checkout -- <path>` after telling the user, and stop.

Done when `roles.json` is written and the script loads the registry.

## 5. Mark the runbooks

The runbooks on the new keys now run per case and need `cases`, a Preconditions `Cases:` list and case role lines. List them:

`node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" contexts --affected <name>`

Show them with their key, one per line. When no runbook is reached, say so and go to step 6.

Ask with `AskUserQuestion`: mark all, mark none, or pick some. On "pick some", ask which runbooks, multi-select in rounds of four, each with its keys in the label. Then run, for the chosen ids:

`node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" mark-review <id...> --reason context-created --context <name>`

Run it without `--write` first, show what it would add to each runbook, and ask whether to write. On a yes, run it again with `--write`.

Done when each chosen runbook has its entry, or the user chose none.

## 6. Show the change

Print, before any commit question:

- the context with its description, keys and cases;
- the runbooks marked, and the number left unmarked;
- the command that resolves each review: `/runbooks:update <id>`.

Done when the user has seen this summary.

## 7. Commit

Commit `roles.json` and the marked runbooks by the `runbooks` policy. Ask an `ask` question only after the summary from step 6 is on screen; the question names the files and the message and does not repeat the summary.

Write in the config `language`.

Done when the user has seen the diff before the write and the summary before any commit question.

## 8. Close

Give the commit outcome: the short sha, or the paths left uncommitted. Then:

- offer `/runbooks:update <id>` for each runbook marked for review, which writes `cases`, the Preconditions lines and the role lines, and clears the review;
- say that `/runbooks:permissions:manage <role>` gives a role different actions per case.
