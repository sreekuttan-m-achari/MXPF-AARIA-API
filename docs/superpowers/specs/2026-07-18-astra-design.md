# A.S.T.R.A. Design Spec

**Date:** 2026-07-18  
**Status:** Accepted — Slice A implementation plan written  
**Repos:** `MXPF-ASTRA-AGENT` (minion) + fleet bridge in `MXPF-AARIA-API`

## Name

| Form | Expansion |
|------|-----------|
| **A.S.T.R.A.** | **Autonomous Site Task & Response Agent** |
| Short | **ASTRA** |

AARIA’s remote **minions** — persistent on-box agents (GitHub/GitLab/Azure runner model) for VPS, Kubernetes, and other online hosts.

## Goals

- Register with AARIA over an always-on MQTT hub and receive jobs / intents
- Stay reachable when AARIA’s laptop has a dynamic IP or flaky network
- Execute allowlisted host actions via pluggable capability packs
- Optional watchdog + proactive events
- Optional on-minion Cursor brain (**default off** — secrets stay on the desk)
- Environment-aware: labels + thin persona pack (`SOUL` / `OBJECTIVES` / `ENV`)

## Non-goals (v1)

- Replacing SSH-Connect interactive MCP sessions
- Requiring self-hosted Mosquitto for day-1 use
- Putting `CURSOR_API_KEY` on shared/multi-user hosts by default

## Architecture (hub-centric fleet)

```
AARIA (desk, flaky)  ←→  MQTT Hub  ←→  ASTRA minions (VPS/K8s, stable)
                              │
                     HiveMQ (default)
                     Mosquitto Compose (optional)
```

- **Hub** is the only always-reachable component (not AARIA’s laptop)
- Both sides dial **outbound** to the broker
- **SSH-Connect** remains desk-side interactive SSH; ASTRA is the persistent site agent

### Hub priority

| Mode | Role |
|------|------|
| **HiveMQ Serverless** | **Default** — zero broker ops |
| **Mosquitto Docker Compose** | **Optional** escape hatch (`deploy/mqtt/`) |

Switch via env (`AARIA_MQTT_*` / `ASTRA_MQTT_*`): provider + URL + username/password.

## Auth & onboarding

- **Per-minion MQTT credentials** (controller user for AARIA; one user per ASTRA)
- **Registration C:** one-time token → pending announce → **AARIA approves** → permanent assignment (labels, caps, identity)
- HiveMQ free tier: coarse pub/sub per user (topic ACLs are app-level until Mosquitto ACLs)

## Protocol (`mxpf/v1`)

| Topic | Direction | Purpose |
|-------|-----------|---------|
| `mxpf/v1/registry/announce` | ASTRA → | Hello / re-announce |
| `mxpf/v1/registry/pending/{agentId}` | → AARIA | Pending registrations |
| `mxpf/v1/registry/approve/{agentId}` | AARIA → | Approval + assignment |
| `mxpf/v1/agents/{agentId}/cmd` | AARIA → | Jobs + chat intents |
| `mxpf/v1/agents/{agentId}/status` | → AARIA | Heartbeat / presence |
| `mxpf/v1/agents/{agentId}/result/{jobId}` | → AARIA | Structured results |
| `mxpf/v1/agents/{agentId}/reply/{msgId}` | → AARIA | Chat / streamed replies |
| `mxpf/v1/agents/{agentId}/event` | → AARIA | Proactive alerts |

Envelope:

```json
{
  "v": 1,
  "type": "cmd.exec | chat.message | chat.cancel | …",
  "id": "uuid",
  "ts": "ISO-8601",
  "agentId": "astra-web-prod",
  "payload": {}
}
```

### Dual payload modes

| `type` | Meaning |
|--------|---------|
| `cmd.exec` | Structured allowlisted action |
| `chat.message` | Natural language intent |
| `chat.cancel` | Cancel in-flight work |

**Default chat path:** AARIA’s Cursor brain (desk) reasons, then emits `cmd.exec` to the minion.  
**Optional:** `ASTRA_BRAIN=1` runs Cursor SDK on the minion (single-tenant hosts only).

QoS 1 for cmd/result/registry; cap log payloads (e.g. 64 KB) to protect HiveMQ free traffic.

## Assignment (identity)

- **Labels:** `role`, `env`, `tags` for routing
- **Persona pack:** `SOUL.md`, `OBJECTIVES.md`, `ENV.md` (thin; used when local brain is on, and summarized to AARIA via registry)

## Capabilities

Pluggable packs; tight **core** by default:

- Core: `health`, sandboxed `exec`, limited `file.*`, `notify`
- Optional packs: `docker`, `nginx`, `k8s` (enabled per agent via labels/approval)

## Build slices

| Slice | Deliverable |
|-------|-------------|
| **A** | Executor minion + HiveMQ + registry/approve + `cmd.exec` |
| **B** | Watchdog, heartbeats, proactive `event`s |
| **C** | Optional local Cursor brain (`ASTRA_BRAIN=1`) |

## AARIA awareness

- `SOUL.md` / `SOUL.sample.md` — fleet division of labour
- `FLEET.md` — live minion roster (bootstrapped into persona)
- `skills/astra-fleet/` — how to command minions
- `.env` — `AARIA_MQTT_*` (HiveMQ default)
- Fleet bridge module (implementation) — MQTT client, registry, TUI/API hooks

## Runtime

- **Node.js ≥ 22** (align with AARIA)
- `@cursor/sdk` only when brain opt-in is enabled

## Security notes

- Never commit `.env` or MQTT passwords
- Prefer desk-side Cursor credentials; avoid keys on shared VPS
- Ask before destructive remote actions
- Rotate credentials if ever pasted into chat/logs

## Related

- `MXPF-AARIA-API` — commander + fleet bridge
- `SSH-Connect` — interactive remote console MCP
- HiveMQ Cloud Serverless — default hub (100 connections / 10 GB/mo free)
