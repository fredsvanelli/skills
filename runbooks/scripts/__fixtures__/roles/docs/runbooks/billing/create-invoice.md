---
id: billing.create-invoice
title: Create an invoice through the API
capability: billing
surface: api
feature: invoices
roles: all
covers:
  entries: ["POST /invoices"]
  requirements: []
sources: []
scripts: []
status: draft
---

# Create an invoice through the API

---

## Goal

A client creates an invoice and reads it back.

---

## Preconditions

- Data: one client, created by the script with a factory.

---

## Steps

### S01. Create the invoice

Parents: none
Endpoint: POST /invoices
Request: body with the client id and an amount of 100.

Expected: status 201 and the body holds the new invoice id.
- viewer: denied. 403
- anonymous: denied. 401

---

### S02. Read the invoice back

Parents: S01
Endpoint: GET /invoices/{id}
Request: the id returned by S01.

Expected: status 200 and the amount is 100.

---

## Not covered

- E-mail sent to the client.

---

## Cleanup

The script runs in a transaction that rolls back.
