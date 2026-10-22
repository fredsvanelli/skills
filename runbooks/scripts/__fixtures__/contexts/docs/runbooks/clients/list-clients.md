---
id: clients.list-clients
title: List clients
capability: clients
surface: ui
feature: list
roles: [viewer, admin]
covers:
  entries: []
  requirements: []
sources: []
scripts: []
status: draft
---

# List clients

---

## Goal

A user sees the client list.

---

## Preconditions

- Account: each role's login from `accounts`.
- Cases:
  - vip-team: client "ACME" with `vip: true`, the role's account added to its team.
  - vip-outside: client "Globex" with `vip: true`, the role's account not on its team.
  - regular: client "Initech" with `vip: false`.

---

## Steps

### S01. Open the list

Actions:
1. Open /clients.
Expected: the page lists the clients.

---

## Not covered

- Sorting.

---

## Cleanup

Delete the records created in Preconditions.
