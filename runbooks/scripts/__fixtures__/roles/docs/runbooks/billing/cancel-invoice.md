---
id: billing.cancel-invoice
title: Cancel an invoice
capability: billing
surface: ui
feature: invoices
roles: all
viewports: [desktop, mobile]
covers:
  entries: ["/billing/invoices"]
  requirements: []
sources: []
scripts: []
status: active
review: [{ reason: role-permissions, role: manager, key: billing/invoices, change: delete removed, date: 2026-10-14 }]
---

# Cancel an invoice

---

## Goal

A user with the right to edit invoices cancels an open invoice.

---

## Preconditions

- Data: one open invoice named "Invoice A".

---

## Steps

### S01. The invoice list shows the open invoice

Parents: none
Page: /billing/invoices
Actions:
1. Open the page.

Expected: the list shows "Invoice A" with the status "Open".
- viewer: read-only. The list shows no "Cancel" button.
- anonymous: denied. The page redirects to the sign-in screen.

---

### S02. Cancel the invoice

Parents: S01
Page: /billing/invoices
Actions:
1. Click "Cancel" on "Invoice A".
2. Confirm in the dialog.

Expected: the status of "Invoice A" changes to "Cancelled".
- editor: hidden. The row shows no "Cancel" button.

---

### S03. The cancellation survives a reload

Parents: S02
Page: /billing/invoices
Actions:
1. Reload the page.

Expected: "Invoice A" still shows the status "Cancelled".

---

## Not covered

- E-mail sent to the client.

---

## Cleanup

Reopen "Invoice A" in the test data.
