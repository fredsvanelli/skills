---
id: <capability>.<flow>
title: <user outcome, in the config language>
capability: <capability>
surface: ui
feature: <feature>
tags: []
roles: [<role>]
viewports: [<viewport>]
# upstream: mocked  # only when the runbook differs from the config upstream.mode: live or mocked
design: {}  # with a design system in the config, one line per screen, indented: <screen>: "<frame link or file path>"
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
Design: <only when the step ends on a screen in `design`: its name; else leave the line out>
Viewports: <only when the step runs at fewer viewports than the runbook; else leave the line out>

Actions:

1. <action, naming the control by its visible label>

Expected: <exact UI text and state; after a reload when the step checks persistence>

## Not covered

- <behavior>: <why the browser cannot show it here>

## Cleanup

- <UI steps or project command that undo the data this runbook created>
