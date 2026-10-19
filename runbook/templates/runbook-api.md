---
id: <capability>.<flow>
title: <business outcome, in the config language>
capability: <capability>
surface: api
feature: <feature>
tags: []
roles: [<role>]
covers:
  entries: []
  requirements: []
sources: []
scripts: []
status: draft
last_run: null
---

# <title>

## Goal

<One or two sentences: the business operation this runbook proves.>

## Preconditions

- Test environment: <tests.api.command; migrations or config the operation needs>
- Auth: <role>, through <the project's test helper, from the agents block>
- Data: <each piece of data, and the factory, seed or call that creates it in the script>

## Steps

### S01. <what this step proves>

Parents: none
Requirement: <requirement id or none>
Endpoint: `<METHOD /path>`
As: <role or anonymous>
Request: <body, query and headers that matter>

Expected: <status; body fields; effects through a read-back call or the framework's fakes>

## Not covered

- <behavior>: <why neither the response, a read-back call nor a fake can show it>

## Cleanup

- Isolated by <RefreshDatabase, a transaction per test, ...>.
