---
id: <capability>.<flow>
title: <user outcome, in the config language>
capability: <capability>
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

<One or two sentences: the user outcome this runbook proves.>

## Preconditions

- Services: <app.start commands; migrations or config the flow needs>
- Accounts: <role> (`<emailEnv>` / `<passwordEnv>`)
- Data: <each piece of data, and the setup step or seed command that creates it>

## Steps

### S01. <what this step proves>

Parents: none
Requirement: <requirement id or none>
Page: `<route>`

Actions:

1. <action, naming the control by its visible label>

Expected: <exact UI text and state; after a reload when the step checks persistence>

## Not covered

- <behavior>: <why the browser cannot show it here>

## Cleanup

- <UI steps or project command that undo the data this runbook created>
