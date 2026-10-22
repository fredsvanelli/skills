---
runbook: <runbook id>
run: <run id>
date: <YYYY-MM-DD HH:MM>
commit: "<short sha>"
branch: <branch>
mode: <guided | headless | headed | chrome | prompt | script | test>
executor: <the user | the agent | Claude in Chrome extension, result reported by the user | the project's test command>
partial: false
upstream: <live | mocked>
roles: [<the roles that ran, in run order; [] when role tracking is off>]
cases: [<the cases that ran, in run order; [] when the runbook has no context>]
viewports: [<name widthxheight, in run order; [] when the runbook has none>]
result: <passed | failed | blocked>
---

# Run <run id>

| Step | State | Role | Case | Viewport | Seen | Evidence |
|---|---|---|---|---|---|---|
| S01 | passed | <role, or leave the column out when role tracking is off> | <case, `*` for a role that ran once, or empty when the runbook has no context> | <viewport, or leave the column out when the runbook has none> | <what was observed> | `<evidence path>` |

<One row per step, role, case and viewport. Rows are grouped by role, then by case, then by viewport, in run order. Leave the Role column out when role tracking is off and the Viewport column out when the runbook has none.>

## Failures

### S0N <as role, with role tracking> <in case, with cases> <@ viewport, with viewports>

Expected: <from the runbook>

Seen: <exact text or state observed>

## Blocked

- S0N: <what is missing>

## No account

- <role>: <the config has no account for this role>

<Role tracking only. Lists the roles without an account; their rows have the state no-account. Leave the section out when every role has an account.>

## Waived

- S0N: <reason, in the user's words>

## Design differences

| Design | Step | Viewport | Severity | Design shows | Page shows |
|---|---|---|---|---|---|
| <name in the runbook's design> | S0N | <viewport, or leave the column out when the runbook has none> | <major or minor> | <what the reference shows> | <what the page shows> |

<ui runbooks with design references only. "None found." when every reference was compared and none differs. The Design column comes first so the table's rows never read as step states. Leave the section out when the runbook has no design references.>

## Other tests in the file

<api runbooks only: tests in the script without a step prefix, with their outcome. They do not change `result`. Leave the section out when there are none.>

## Notes

<fixtures not recorded from the live API, with their count (schema, hand-written), in a mocked run>
<base URL or test command, accounts used by role, data used, script mistakes fixed during the run, design references not compared and why, anything unusual about this run>
