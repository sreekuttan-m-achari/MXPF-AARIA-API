---
name: work-desk-ops
description: "Operational checks for the ARIA work desk — services, host health, git status."
version: 1.0.0
author: AARIA
---

# Work desk ops

When asked for a status check or "is everything up":

1. Check ARIA `/health` and Amelia `/health` on localhost
2. Note host memory and load if elevated (>80% RAM or load > cores)
3. Summarize in a compact table — FRIDAY tone, no fluff
4. Flag risks (prod ops, destructive commands) before suggesting actions

Delegate home automation and HA entity checks to Amelia.
