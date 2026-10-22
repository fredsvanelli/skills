---
id: clients.edit-client
title: Edit a client
capability: clients
surface: ui
feature: edit
roles: all
cases: all
covers:
  entries: []
  requirements: []
sources: []
scripts: []
last_run: { date: 2026-10-21, commit: "abc1234", result: passed, report: _runs/2026-10-21-1000-clients.edit-client.md }
status: active
---

# Edit a client

---

## Goal

A user edits a client record.

---

## Preconditions

- Account: each role's login from `accounts`.
- Cases:
  - vip-team: client "ACME" with `vip: true`, the role's account added to its team.
  - vip-outside: client "Globex" with `vip: true`, the role's account not on its team.
  - regular: client "Initech" with `vip: false`.

---

## Steps

### S01. Open the client

Actions:
1. Open the client from the list.
Expected: the page shows the client.

---

### S02. The manager edits the client

Parents: S01
Requirement: none
Page: /clients/{id}
Actions:
1. Click "Edit".
2. Change the phone to "555-0100" and click "Save".
Expected: the page shows "Saved" and the phone "555-0100".
- manager in vip-outside: read-only. The "Edit" button does not appear.
- viewer: read-only. The "Edit" button does not appear.

---

## Not covered

- E-mail sent to the client.

---

## Cleanup

Delete the records created in Preconditions.
