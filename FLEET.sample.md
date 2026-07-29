# ASTRA Fleet

Live roster and operating notes for **A.S.T.R.A.** minions
(**Autonomous Site Task & Response Agent**). AARIA loads this file at bootstrap when present.

Copy to `FLEET.md` and keep the roster current.

## Hub

| Field | Value |
|-------|--------|
| Provider | HiveMQ (default) — Mosquitto optional |
| Role | Always-on MQTT bus |
| Controller MQTT user | *(your AARIA HiveMQ username)* |

## Minions

| Agent ID | Name | Host / site | Labels | Caps | Status |
|----------|------|-------------|--------|------|--------|
| | | | | | |

## How AARIA should use the fleet

1. Prefer **desk brain → structured commands** to minions. Local Cursor brain on a minion is opt-in only.
2. Match work to labels and capability packs.
3. Ask before destructive remote actions.
4. Use SSH-Connect for interactive sessions; ASTRA for persistent site agents.

## Notes

- Do not store secrets in this file.
