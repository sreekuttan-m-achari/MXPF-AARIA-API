# Web console MQTT bridge — Design

**Date:** 2026-08-30  
**Status:** Draft — implement via [plan](../plans/2026-08-30-web-console-mqtt-bridge.md)  
**Repo:** `MXPF-AARIA-API`

## Goal

Expose each AARIA desk to the static web PWA (`MXPF-AARIA-WEB-UI` / [aaria.maximprof.com](https://aaria.maximprof.com/)) over HiveMQ **console topics** under `mxpf/v1/aria/*`. The browser never talks to ASTRA minions directly.

## Upstream specs

Full topic/envelope and UX contracts live in the web UI repo:

- `MXPF-AARIA-WEB-UI/docs/superpowers/specs/2026-08-30-aaria-web-ui-design.md`
- `MXPF-AARIA-WEB-UI/docs/superpowers/specs/2026-08-30-aaria-web-ui-auth-design.md` (balanced: pair once, device token)

This document only records API-side decisions.

## Decisions

| Topic | Choice |
|-------|--------|
| Transport | Same fleet MQTT connection (`AARIA_MQTT_*`) |
| Namespace | `mxpf/v1/aria/` only |
| Discovery | Publish `aria.announce` + periodic `aria.status` |
| Auth | Device pairing (`console.pair` → TUI approve → `deviceToken`) |
| Chat | Reuse `handleChatTurn`; stream `chat.chunk` / `chat.done` on `web/out/{msgId}` |
| Gate | `AARIA_CONSOLE_ENABLED=1` + `AARIA_CONSOLE_ID` |
| Default | **Off** until configured |

## Non-goals (v1)

- Firebase Auth / custom HTTP API for the PWA
- Minion contacts in the web roster
- Master `consoleToken` in the browser (web client already uses device tokens)
- Changing fleet/minion topic plane

## Module layout

```
src/console/
  topics.ts config.ts device-store.ts pairing.ts
  chat-handler.ts bridge.ts index.ts
```

Lifecycle: start after fleet bus connects; stop with fleet shutdown.

## Success

Desk appears in the web Instances list; operator can pair via `/console pair <code>` and chat with streaming replies.
