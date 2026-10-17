You are running a UAT runbook in this browser tab. I am already signed in as <role>. Stay on pages under <baseUrl>.

Rules:
- Follow the steps in order and do only what each step's actions say.
- After each step, compare the screen with "Expected" and report what you saw, quoting on-screen text exactly.
- When a step fails, continue with the next one. A step whose parent did not pass is "blocked-by-parent": skip it.
- When something you need is missing (data, a button, access), mark the step "blocked" and say what is missing.
- Change nothing beyond what the steps ask.

Preconditions:
<preconditions from the runbook>

Steps:
<for each step, in run order:
S01. <title>
Parents: <parents>
Page: <baseUrl><route>
Actions:
1. <action>
Expected: <expected>>

When you finish, reply with this block and nothing after it:

RUNBOOK RESULT <runbook id>
S01 | <passed|failed|blocked|blocked-by-parent> | <what you saw>
S02 | <passed|failed|blocked|blocked-by-parent> | <what you saw>
END
