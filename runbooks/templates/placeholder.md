---
id: <capability>.<flow>
title: <user outcome, in the config language>
capability: <capability>
surface: <ui | api>
feature: <feature>
tags: []
roles: all  # valid only with role tracking on; with tracking off write roles: []
covers:
  entries: []
  requirements: []
# calls: []  # ui only, with an upstream API in another repository: the operations the screens reach, as METHOD /path
sources: ["map <short sha>"]
scripts: []
status: placeholder
last_run: null
---

# <title>

---

## Goal

<One or two sentences: the user outcome this runbook will prove.>

---

## Steps

None yet. `/runbooks:create --from placeholder <capability>.<flow>` writes them.
