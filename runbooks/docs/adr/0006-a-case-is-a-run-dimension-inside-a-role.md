# A case is a run dimension inside a role, not a role of its own

Many systems decide access from the record as well as from the role: on a VIP client, a manager on the client's team can edit and a manager outside it can only view, while on a client that is not VIP every manager can edit. The same `manager` login gets different actions on different records, so one list of actions per `capability/feature` key cannot hold the rule. We added contexts to `roles.json`: a context names the question about the record and lists its keys and its cases, and a role's entry on such a key can map each case to its own actions. A runbook on that key runs per case inside each role, as it runs per viewport, with the order role, then case, then viewport. Each step states what each role gets in each case through role lines with `in <case>`, and states, coverage, review marks and the CSV all carry the case. We chose this because a case describes the record and not the user, so the role keeps one account and one login across all its cases, and each case's limit becomes an Expected that a step checks, where `partial` only says that a limit exists.

## Considered Options

- A fake role per situation (`manager-vip-team`, `manager-vip-outside`). Rejected: each one needs an account that is really the same login, and the registry stops matching the roles the code defines.
- Splitting the feature by record kind (`clients/vip-edit`, `clients/regular-edit`). Rejected: it works only when the runbooks split the same way, and the team question has no feature to split on.
- The outcome `partial` on the step. Rejected: it says access is limited without saying where, so no step can test it, and coverage cannot tell which records the role reaches.
- Running every role in every case. Rejected as the default: a role whose actions do not change by case would repeat passes that prove nothing new. A role with the same actions in every case and no line naming a case runs once, under the case `*`.

## Consequences

- One context per key. Two questions on the same key (VIP-ness and invoice status) need one context with the combined cases, because the cross product is out of this version.
- A case name is unique across every context, so a case alone names it in role lines, `+<case>` fixture folders, test names and the CSV.
- A registry with no `contexts` stays at version 1 and behaves as before. A file with `contexts` is version 2, so an older plugin stops with an unsupported version instead of misreading a map as a list.
- The plugin never evaluates the condition in the project's code. The Preconditions `Cases:` lines say how to build each case's record, and a case whose data cannot be built makes its pass `blocked`.
