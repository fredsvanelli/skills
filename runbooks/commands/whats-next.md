---
description: Compare the state of the runbooks with the code and its latest changes, and suggest the three commands that make the most sense to run now
argument-hint: "[--since <ref>]"
disable-model-invocation: true
---

# What's next

Arguments: `$ARGUMENTS`

## Parameters

| Parameter | Use |
|---|---|
| `--since <ref>` | optional: the base of the changes to read (`HEAD~3`, `develop`, a commit). Without it, the base is `git.base` on any other branch, and `HEAD~1` (the last commit) on `git.base` itself. Uncommitted and untracked files always count |

Examples: `/runbooks:whats-next`, `/runbooks:whats-next --since HEAD~5`, `/runbooks:whats-next --since develop`.

Answers one question: given the state of the runbooks and the state of the code, and what the latest changes touched, which command makes the most sense to run now? The answer is three commands, ready to copy, each with the facts that put it there.

Read-only until the user picks a suggestion in step 6. It runs no runbook, writes no file and commits nothing. Every suggestion comes from a fact this command read: a script output, a file, a line of the diff. A suggestion without one is not made.

Every `runbooks.mjs` call below is `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" <command>`, run from the project root. Keep its stderr: each `warning:` line is a signal of its own.

## 1. Read the install

1. `docs/runbooks/runbooks.config.json`. When it is missing, the project has no install. The first suggestion is `/runbooks:setup`, the other two are `/runbooks:help --about overview` and `/runbooks:help --about lifecycle`, and the command goes to step 6.
2. `runbooks.mjs list --json`. Exit code 2 stops the reading, and its message picks the first suggestion:
   - `roles.json not found`: tracking is on and the roles were never registered. Suggest `/runbooks:roles:generate <file>` when the project holds a document about who may do what (search `docs/` for access, permission or role matrices), else `/runbooks:roles:create`.
   - any other message: the `/runbooks:settings` group whose keys it names (step 2 of `${CLAUDE_PLUGIN_ROOT}/commands/settings.md`), else `/runbooks:setup`.

   Quote the message as the reason, fill the other two suggestions with the commands that follow the fix (the roles commands of step 5, then `/runbooks:whats-next` again), and go to step 6.
3. From the config, keep `stack`, `language`, `git.base`, `staleDays`, `roles.enabled`, `accounts`, `tests`, `upstream` and `design`. Note what setup left unfinished:
   - a surface the stack allows with no `tests.<surface>`, or with no `command` (`api` needs it; `ui` needs it only for scripts);
   - `ui` in the stack with an empty `app.baseUrl` or no `accounts`;
   - `ui` in the stack with the `mcp.headless` or `mcp.headed` server missing from `.mcp.json`;
   - the obsolete `paths.e2e` key, which `setup` migrates;
   - `entries` or `slices` empty, so coverage has nothing to measure.

Done when you hold the config, the runbook list and its warnings, or the command went to step 6.

## 2. Read the runbooks

From the `list --json` output (`${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/format.md`, Frontmatter and Status), count and name:

- `invalid`: runbooks with `problems`, and the `warning:` lines that name a runbook file;
- `review`: runbooks with a `review` key, with their reasons;
- `placeholder`: runbooks with `status: placeholder`;
- `never-run`: `draft` runbooks with no `last_run`;
- `no-script`: `api` runbooks with an empty `scripts`;
- `outdated`: runbooks whose `last_run.outdated` is true;
- `failing`: `active` or `draft` runbooks whose `last_run.result` is `failed` or `blocked`;
- `stale`: `active` or `draft` runbooks whose `last_run.date` is more than `staleDays` days before today.

Tag each with `critical` when its `tags` hold it.

Then the coverage: `runbooks.mjs coverage --json`. Keep the entry and requirement totals, `covered`, `pending`, `planned` and the `uncovered` lists. An uncovered entry is one no runbook cites in any status, placeholders included, so `map` has not reached it. A warning about an `entries` source or a slice outside the project is a `/runbooks:settings sources` signal (`${CLAUDE_PLUGIN_ROOT}/docs/adr/0005-upstream-api-in-another-repo-is-a-contract.md`).

With `upstream.schema` in the config, also run `runbooks.mjs contract` and keep its findings.

Done when you hold every count above with the ids behind it, and the coverage numbers.

## 3. Read the roles

Only with `roles.enabled` true. With it off, skip to step 4; a change in the diff that adds role or permission checks (step 4) is then a `/runbooks:settings roles` signal.

1. `runbooks.mjs roles`.
2. From the table, note:
   - a registry with `anonymous` and no other role, so the roles were never defined (`/runbooks:roles:generate` or `/runbooks:roles:create`, as in step 1);
   - roles with `Guesses` above 0: their permissions came from a guess, and `/runbooks:permissions:manage <name>` confirms them;
   - roles with `Account` `no` (other than `anonymous`) in a stack with `ui`: their passes end `no-account`, and `/runbooks:settings accounts` gives them one;
   - roles with `Runbooks` 0: no runbook runs them, so nothing proves what they may do;
   - roles with `Reviews` above 0: the same runbooks as the `review` count, seen per role.
3. `runbooks.mjs contexts`. Note contexts with `Runbooks` 0 (their keys match no runbook, a `/runbooks:contexts:update` signal) and the keys a role gives a different action list per case.

Done when you hold the role and context signals, or tracking is off.

## 4. Read the changes

1. The base: `--since`, else `HEAD~1` when the current branch is `git.base`, else `git.base`. When the base does not resolve (a repository with one commit, a branch not fetched), say so and use the uncommitted changes only.
2. `git log --oneline <base>..HEAD`, `git diff --stat <base>`, and `git status --porcelain`. Read the diff of the files that matter for runbooks: routes, pages, controllers and handlers, guards and policies, the files `roles.json` keys reach, the files of `uiText`, `upstream.schema`, and the runbooks folder itself.
3. `runbooks.mjs list --affected <base> --json`: the runbooks the changes reach, each with its `reasons`.
4. Put each change in one class:

| Class | The change | Candidate |
|---|---|---|
| `behavior` | an affected runbook's flow now acts differently (a new field, a renamed button, a new validation, a changed response), so its text is wrong | `/runbooks:update <id> --from diff <base>` |
| `refactor` | an affected runbook's flow acts the same, so its text holds and a run proves it | `/runbooks:run --affected <base>` |
| `new flow` | a new route, page or endpoint that `coverage` lists as uncovered | `/runbooks:create --from diff <base>`, or `/runbooks:map --path <glob>` for several |
| `access` | a role, permission or ownership check changed | tracking on: `/runbooks:permissions:manage <role>` for a changed rule; `/runbooks:contexts:create` for a rule that depends on the record (the user's team, the record's owner, a VIP flag) on a key no context holds; `/runbooks:contexts:update <name>` for a new case of an existing context. Tracking off: `/runbooks:settings roles` |
| `contract` | `upstream.schema` changed; the affected reasons name the operations | `/runbooks:update <id> --from diff <base>`, which records the fixtures again |
| `runbooks only` | only files in the runbooks folder changed | none of its own. A runbook written in them and not run since is already `never-run` or `outdated` in step 2 |
| `unrelated` | docs, config, dependencies, tests outside `tests.<surface>.dir` | none |

Done when every changed file that reaches a runbook, an entry or a role is in one class.

## 5. Rank

Each signal from steps 1 to 4 gives one candidate: a command with its arguments filled in. Rank them by the first tier that applies, higher first:

| Tier | Signals | Why it comes first |
|---|---|---|
| 1. Blocked | no config, a config error, `api` in the stack with no `tests.api.command`, a registry with no role but `anonymous` | the other commands fail or give wrong results until it is fixed |
| 2. The current change | `behavior`, `new flow`, `access` and `contract` changes from step 4 | the code moved away from the runbooks, and the diff is fresh |
| 3. Text that is wrong | `invalid`, `review`, contract findings | a run of a wrong runbook proves nothing |
| 4. Unproven work | `never-run`, `outdated`, `failing`, `no-script`, `refactor` changes from step 4 | these runbooks exist and do not count yet, or may no longer hold |
| 5. Gaps | uncovered entries (`/runbooks:map`), `placeholder` (`/runbooks:create --from placeholder <id>`), roles with 0 runbooks, guessed permissions, roles with no account, unfinished setup items from step 1 | coverage the project planned and did not write, or never planned |
| 6. Upkeep | `stale` (`/runbooks:run <id...>`), then `/runbooks:audit --all` and `/runbooks:coverage` | nothing is broken, and these show whether the runbooks still match the code |

Inside a tier, rank higher a candidate that reaches `critical` runbooks, then one the diff reaches, then the one with more runbooks or entries behind it.

Order matters between some commands even inside a tier:

- `map` comes before `create --from placeholder`: placeholders exist only after it.
- With tracking on, define roles (`roles:generate`, `roles:create`) before `permissions:manage`, and both before `contexts:create`: a context changes permissions that must exist first.
- `update` comes before `run` for the same runbook: running text you know is wrong wastes the run.
- `to-test` comes before `run` for an `api` runbook with no script: it runs only through one.

Then pick three:

- Three different commands, or the same command with different targets when nothing else applies. Join the ids one command takes in a single line (`/runbooks:run billing.issue-invoice billing.cancel-invoice`). `update`, `to-test`, `create` and `permissions:manage` take one target, so name the first and say how many more there are.
- When fewer than three candidates exist, fill the list from tier 6, and say the install is in good shape.
- Never suggest `/runbooks:upgrade` from this state: nothing here reads the installed version.

Done when you hold three commands, each with its tier and the facts behind it.

## 6. Answer

Write in the config `language`, else English. Command names, ids, file names and terms of `${CLAUDE_PLUGIN_ROOT}/CONTEXT.md` stay as they are.

1. **State.** At most six lines: the stack and whether roles are tracked; the runbooks per status; entry and requirement coverage; the base read and how many commits and changed files it holds; the affected runbooks; the counts from step 2 that are not zero.
2. **Next.** The three commands, numbered in rank order. Each one:
   - the command on its own line, in a code span, ready to copy;
   - why now, in one or two sentences, quoting the facts: the ids, the files of the diff, the numbers, the warning text;
   - what it unblocks, when a later suggestion or another signal depends on it.
3. **Also seen.** The other candidates, one line each with their command, at most five. Leave it out when there are none.

Then ask with `AskUserQuestion` which of the three to run, with one option per suggestion and the command as its label. When the user picks one, read `${CLAUDE_PLUGIN_ROOT}/commands/<name>.md` (`commands/roles/generate.md` for `/runbooks:roles:generate`) and follow it with the arguments shown. That command then writes and commits by its own rules.

Done when the user has the state, three commands each with its reason, and was offered to run one.
