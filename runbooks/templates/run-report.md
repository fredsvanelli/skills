---
runbook: <runbook id>
run: <run id>
date: <YYYY-MM-DD HH:MM>
commit: "<short sha>"
branch: <branch>
mode: <guided | headless | headed | chrome | prompt | script | test>
executor: <the user | the agent | Claude in Chrome extension, result reported by the user | the project's test command>
partial: false
viewports: [<name widthxheight, in run order; [] when the runbook has none>]
result: <passed | failed | blocked>
---

# Run <run id>

| Step | State | Viewport | Seen | Evidence |
|---|---|---|---|---|
| S01 | passed | <viewport, or leave the column out when the runbook has none> | <what was observed> | `<evidence path>` |

<With viewports, one row per step and viewport, grouped by viewport in run order.>

## Failures

### S0N <@ viewport, with viewports>

Expected: <from the runbook>

Seen: <exact text or state observed>

## Blocked

- S0N: <what is missing>

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

<base URL or test command, accounts used by role, data used, script mistakes fixed during the run, design references not compared and why, anything unusual about this run>
