---
id: billing.legacy
title: Review an invoice as admin
capability: billing
surface: ui
feature: invoices
roles: [admin]
covers:
  entries: ["/billing/invoices/review"]
  requirements: []
sources: []
scripts: []
status: draft
---

# Review an invoice as admin

---

## Goal

An admin opens the review screen of an invoice.

---

## Preconditions

- Data: one open invoice named "Invoice A".

---

## Steps

### S01. Open the review screen

Parents: none
As: admin
Page: /billing/invoices/review
Actions:
1. Open the page.

Expected: the screen shows "Invoice A" with the button "Approve".

---

## Not covered

- Approval itself.

---

## Cleanup

None.
