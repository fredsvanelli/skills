---
id: quotes.list-quotes
title: List quotes and open one
capability: quotes
roles: [admin]
covers:
  entries: [/quotes, "/quotes/[id]"]
  requirements: []
calls: [GET /quotes, GET /quotes/{id}]
sources: []
scripts: ["e2e/quotes/list-quotes.runbook.spec.ts"]
status: active
---

# List quotes and open one
