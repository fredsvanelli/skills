---
id: billing.list-invoices
title: List invoices through the API
capability: billing
surface: api
feature: invoices
roles: all
covers:
  entries: ["GET /invoices"]
  requirements: []
sources: []
scripts: []
status: draft
---

# List invoices through the API

---

## Goal

A user lists invoices.

---

## Preconditions

- Data: one invoice, created by the script with a factory.

---

## Steps

### S01. List the invoices

Parents: none
Endpoint: GET /invoices
Request: no body.

Expected: status 200 and the list holds the invoice.

---

## Not covered

- Pagination.

---

## Cleanup

The script runs in a transaction that rolls back.
