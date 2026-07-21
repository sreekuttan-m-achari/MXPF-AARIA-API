---
name: astra-fleet
description: "Command and reason about ASTRA minions — remote site agents over the MQTT fleet hub."
version: 1.1.0
author: AARIA
---

# ASTRA fleet ops

**A.S.T.R.A.** = **Autonomous Site Task & Response Agent** — AARIA’s remote minions
(runner-style agents on VPS/K8s). Roster lives in `FLEET.md`.

## When to use

- User asks about a remote host, VPS, or “minion” / “astra”
- Deploy, restart, health-check, or inspect infra on a managed site
- Roll out ASTRA code updates to the fleet (all or selected minions)
- Proactive alerts arriving from the fleet (when bridge is live)

## Operating rules

1. **You are the brain by default.** Minions are executors. Do not assume `CURSOR_API_KEY` exists on the remote box.
2. Read `FLEET.md` for agent IDs, labels, **purpose**, and capability packs before targeting work.
   Per-minion host profiles also live under `data/fleet/hosts/{agentId}.md` (summary from announce; full markdown after `host.profile`).
3. Prefer structured actions the minion allowlists (`health`, sandboxed `exec`, `host` / `host.profile`, `self.update`, optional packs later).
   Use `host.profile` (args `{ "refresh": true }` to re-probe) when you need the full HOST.md for a site.
4. Confirm destructive actions with the user first.
5. If the fleet bridge is not connected yet, say so honestly and fall back to SSH-Connect / manual steps.
6. Home / HA tasks still go to **Amelia** — ASTRA is work/infra only.

## Remote fleet update

When the user asks to upgrade / update ASTRA on the fleet (or named minions), use the desk API:

```bash
# All approved minions
curl -s -X POST http://127.0.0.1:8788/fleet/update \
  -H 'content-type: application/json' \
  -d '{"agentIds":"all"}'

# Specific minions
curl -s -X POST http://127.0.0.1:8788/fleet/update \
  -H 'content-type: application/json' \
  -d '{"agentIds":["astra-vmi548194","astra-winmagictoys-v2"],"refreshHost":true}'
```

Body fields:
- `agentIds`: `"all"` (default) or an array of agent IDs
- `refreshHost`: re-probe `HOST.md` during upgrade
- `reinstall`: wipe `node_modules` then reinstall (keeps `.env` / `data/` / `HOST.md`)
- `skipPull`: skip `git pull` (local-only refresh)

Prefer this over ad-hoc `exec` of `install-upgrade.sh`. Minions with the `update` cap get `self.update` (detached); older ones fall back to sandboxed `exec` + `nohup`. Expect brief offline blips while services restart. Confirm with the user before `reinstall: true` or fleet-wide updates.

## Response style

FRIDAY tone: name the target minion, state the intended action, report outcome compactly.
