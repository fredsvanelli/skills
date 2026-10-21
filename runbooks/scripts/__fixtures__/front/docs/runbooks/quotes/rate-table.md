---
id: quotes.rate-table
title: Estimate the tax from the rate table
capability: quotes
upstream: live
roles: [admin]
covers:
  entries: ["/quotes/[id]"]
  requirements: []
calls: [GET /quotes/{id}, POST /quotes/{id}/tax-estimate]
sources: []
scripts: []
status: active
---

# Estimate the tax from the rate table
