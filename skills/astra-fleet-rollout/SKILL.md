---
name: astra-fleet-rollout
description: "Roll latest Astra agent to approved fleet minions (skip demo), verify heartbeats, and recover stalled restarts via SSH."
author: AARIA
---

# Astra fleet rollout

## Scope
- Update **approved/production** minions only.
- **Exclude** the demo minion unless the user explicitly includes it.

## Steps
1. Dispatch fleet upgrade/rollout jobs for the approved set.
2. Wait for pull + service restart; confirm each minion heartbeats and reports the new git/version.
3. If upgrade pulls code but **stalls on restart** (`/dev/tty` and/or npm/`tsx` PATH): restart `astra-agent` on the host.
4. If agents go **idle / stop heartbeating**, recover over **SSH** (service status/logs, fix PATH, start `astra-agent`).
5. Common failure: missing **`tsx`** on PATH after restart — install/fix PATH, then start the service.
6. Re-approve healthy minions with the intended capability set; re-check presence and version.

## Notes
- Code-on-disk current ≠ runtime rolled out until the service is healthy again.
- Prefer verify-after-restart before calling the rollout done.
