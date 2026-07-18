# ASTRA Fleet

Live roster and operating notes for **A.S.T.R.A.** minions
(**Autonomous Site Task & Response Agent**). AARIA loads this file at bootstrap when present.

## Hub

| Field | Value |
|-------|--------|
| Provider | HiveMQ (default) |
| Role | Always-on MQTT bus — AARIA and all minions dial out |
| Controller MQTT user | `mxpfaaria` |

## Minions

<!-- FLEET:BEGIN -->
| Agent ID | Name | Host / site | Labels | Caps | Status |
|----------|------|-------------|--------|------|--------|
| astra-demo | demo | pop-os | env=lab | health, exec | approved |
| astra-vmi548194 | astra-ironssvm | vmi548194.contaboserver.net | env=prod, role=vps, host=vmi548194 | health, exec | approved |
| astra-ip-172-26-12-196 | astra-dr-n-me-vps | ip-172-26-12-196 | env=prod, role=vps, cloud=aws, site=drandme | health, exec | approved |
<!-- FLEET:END -->

## How AARIA should use the fleet

1. Prefer **desk brain → structured `cmd.exec`** to minions (default). Do not assume a minion has a local Cursor key.
2. Match work to labels (env, role, tags) and enabled capability packs.
3. Ask before destructive remote actions (restarts, deletes, firewall changes).
4. When fleet bridge APIs exist: check status/heartbeats before claiming a host is healthy.
5. SSH-Connect remains valid for interactive one-off console work; ASTRA is for persistent site presence.

## Notes

- Update this table when minions are approved or decommissioned.
- Do not store MQTT passwords or `CURSOR_API_KEY` in this file.
