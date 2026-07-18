---
name: astra-fleet
description: "Command and reason about ASTRA minions — remote site agents over the MQTT fleet hub."
version: 1.0.0
author: AARIA
---

# ASTRA fleet ops

**A.S.T.R.A.** = **Autonomous Site Task & Response Agent** — AARIA’s remote minions
(runner-style agents on VPS/K8s). Roster lives in `FLEET.md`.

## When to use

- User asks about a remote host, VPS, or “minion” / “astra”
- Deploy, restart, health-check, or inspect infra on a managed site
- Proactive alerts arriving from the fleet (when bridge is live)

## Operating rules

1. **You are the brain by default.** Minions are executors. Do not assume `CURSOR_API_KEY` exists on the remote box.
2. Read `FLEET.md` for agent IDs, labels, and capability packs before targeting work.
3. Prefer structured actions the minion allowlists (`health`, sandboxed `exec`, optional `docker` / `nginx` / `k8s`).
4. Confirm destructive actions with the user first.
5. If the fleet bridge is not connected yet, say so honestly and fall back to SSH-Connect / manual steps.
6. Home / HA tasks still go to **Amelia** — ASTRA is work/infra only.

## Response style

FRIDAY tone: name the target minion, state the intended action, report outcome compactly.
