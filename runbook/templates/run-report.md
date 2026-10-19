---
runbook: <runbook id>
run: <run id>
date: <YYYY-MM-DD HH:MM>
commit: "<short sha>"
branch: <branch>
mode: <guided | headless | headed | chrome | prompt | script | test>
executor: <the user | the agent | Claude in Chrome extension, result reported by the user | the project's test command>
partial: false
result: <passed | failed | blocked>
---

# Run <run id>

| Step | State | Seen | Evidence |
|---|---|---|---|
| S01 | passed | <what was observed> | `<evidence path>` |

## Failures

### S0N

Expected: <from the runbook>

Seen: <exact text or state observed>

## Blocked

- S0N: <what is missing>

## Waived

- S0N: <reason, in the user's words>

## Other tests in the file

<api runbooks only: tests in the script without a step prefix, with their outcome. They do not change `result`. Leave the section out when there are none.>

## Notes

<base URL or test command, accounts used by role, data used, script mistakes fixed during the run, anything unusual about this run>
