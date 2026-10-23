---
id: <capability>.<flow>
title: <business outcome, in the config language>
capability: <capability>
surface: api
feature: <feature>
tags: []
roles: [<role>]  # only with role tracking (roles.enabled): all, or a list of registered roles
# cases: all  # only with role tracking, on a runbook whose capability/feature belongs to a context: all, or a list of its cases
covers:
  entries: []
  requirements: []
sources: []
scripts: []
status: draft
last_run: null
---

# <title>

---

## Goal

<One or two sentences: the business operation this runbook proves.>

---

## Preconditions

- Test environment: <tests.api.command; migrations or config the operation needs>
- Auth: <role>, through <the project's test helper, from the agents block>
<Only with role tracking (roles.enabled): one Auth line per role that runs this runbook, through the same helper. `anonymous` sends no credentials.>
- Data: <each piece of data, and the factory, seed or call that creates it in the script>
- Cases:
  - <case>: <the record of this case and the factory that builds it in each test, such as `Client::factory()->vip()->withTeam($user)`>
<Only on a runbook with cases: one line per case of `cases`. Leave the Cases list out otherwise.>

---

## Steps

### S01. <what this step proves>

Parents: none
Requirement: <requirement id or none>
Endpoint: `<METHOD /path>`
As: <role or anonymous. Only with role tracking off: with role tracking (roles.enabled), leave the line out, because the role lines below replace it>
Cases: <only with cases, when the step runs in fewer cases than the runbook; else leave the line out>
Request:

```http
<METHOD /path?query>
<Header: value, only the headers that matter>

<JSON body, when the endpoint takes one>
```

Expected: <status>.

```json
<the body fields this step checks: a key left out is not checked, an array lists its items in order, a value known only at run time is a string in angle brackets ("<uuid>", "<ISO 8601>")>
```

<effects through a read-back call or the framework's fakes; a sentence when only some items matter or the order does not>
<Only with role tracking (roles.enabled): one line per role whose behavior differs, starting with allowed, denied or partial. denied states the status and the body: 403 for a signed-in role, 401 for anonymous. Leave them out when tracking is off.>
- <role>: denied. 403 with <body>.
- anonymous: denied. 401 with <body>.
- <role> in <case>: denied. <only with cases: 403 with <body> in that case. It wins over the role's line with no case>

<With role tracking off, the role that must not get in (403) and no authentication (401) are steps of their own, each with its As: line. With role tracking on, they are the role lines above, on the main step (format.md, "What a step can verify").>

---

## Not covered

- <behavior>: <why neither the response, a read-back call nor a fake can show it>

---

## Cleanup

- Isolated by <RefreshDatabase, a transaction per test, ...>.
