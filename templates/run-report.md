---
runbook: <runbook id>
run: <run id>
date: <YYYY-MM-DD HH:MM>
commit: "<short sha>"
branch: <branch>
mode: <guided | headless | headed | chrome | prompt | script>
executor: <the user | the agent | Claude in Chrome extension, result reported by the user>
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

## Notes

<base URL, accounts used by role, data used, anything unusual about this run>
