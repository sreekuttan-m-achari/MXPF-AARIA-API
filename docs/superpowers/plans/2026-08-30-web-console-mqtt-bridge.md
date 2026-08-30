# Web console MQTT bridge — Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use checkbox syntax (`- [ ]`).

**Date:** 2026-08-30  
**Repo:** `MXPF-AARIA-API` (`main`)  
**Goal:** Make AARIA desks appear in [aaria.maximprof.com](https://aaria.maximprof.com/) and accept chat from the web PWA over dedicated console topics.

**Why empty roster today:** Web UI only lists peers that publish `aria.announce` on `mxpf/v1/aria/registry/announce`. Fleet MQTT today covers **ASTRA minions** (`mxpf/v1/registry/*`, `mxpf/v1/agents/*`) only — **no** `mxpf/v1/aria/*` console handler.

**Upstream contracts (source of truth for payloads):**

| Spec | Location |
|------|----------|
| Topics + chat envelopes | `MXPF-AARIA-WEB-UI/docs/superpowers/specs/2026-08-30-aaria-web-ui-design.md` |
| Pair once / device token | `MXPF-AARIA-WEB-UI/docs/superpowers/specs/2026-08-30-aaria-web-ui-auth-design.md` (balanced model) |
| Web client behaviour | `MXPF-AARIA-WEB-UI/src/mqtt/client.ts`, `src/store/app.ts`, `src/types/index.ts` |

**Architecture:** Reuse the existing HiveMQ **fleet bus** (`src/fleet/bus.ts`) on the same MQTT connection. Add a **console bridge** that announces this desk, heartbeats status, and handles `web/in` → agent chat → `web/out/{msgId}`. Do **not** let the browser touch `mxpf/v1/agents/*`.

**Tech stack:** Existing `mqtt` + fleet envelope (`src/fleet/envelope.ts`), `handleChatTurn` (`src/chat.ts`), TUI slash commands (`src/tui/commands.ts`), Zod, Node tests under `src/__tests__/`.

```
Web PWA ──wss──► HiveMQ ◄──mqtt── AARIA API (this plan)
                                    ├── fleet bridge (minions) — already exists
                                    └── console bridge (web UI) — NEW
```

---

## Global constraints

- Keep console namespace **`mxpf/v1/aria/`** separate from minion plane.
- Auth for v1 = **device pairing** (`console.pair` → TUI approve → `console.paired` + `deviceToken`). Match what the shipped web UI already sends (`deviceToken`, not master `consoleToken` on every message).
- Gate with `AARIA_CONSOLE_ENABLED=1`; default **off** until configured.
- Reuse one MQTT client (fleet bus). Same `AARIA_MQTT_*` credentials as the desk controller (`mxpfaaria`) — desk publishes/subscribes console topics; HiveMQ ACL for `web-console` stays browser-only.
- Stream replies with the same message `id` the web sent (`chat.chunk` / `chat.done`).
- No secrets in git; document env in `.env.example` only.

---

## Topic / message contract (implement exactly)

| Topic | Direction | Types |
|-------|-----------|-------|
| `mxpf/v1/aria/registry/announce` | AARIA → Web | `aria.announce` |
| `mxpf/v1/aria/{ariaId}/status` | AARIA → Web | `aria.status` |
| `mxpf/v1/aria/{ariaId}/web/in` | Web → AARIA | `console.pair`, `chat.message`, `chat.cancel` |
| `mxpf/v1/aria/{ariaId}/web/out/{msgId}` | AARIA → Web | `console.paired`, `console.denied`, `chat.delivered`, `chat.read`, `chat.chunk`, `chat.done`, `chat.error`, `chat.cancelled` |
| `mxpf/v1/aria/{ariaId}/web/out/typing` | AARIA → Web | `chat.typing` `{ active: true\|false }` |

Envelope: existing fleet shape (`v:1`, `type`, `id`, `ts`, `agentId`, `payload`). Here **`agentId` = ariaId** (desk id).

**Web → pair (already published by PWA):**

```json
{ "type": "console.pair", "agentId": "<ariaId>", "payload": {
  "deviceId": "…", "code": "472918", "label": "Alice · Chrome"
}}
```

**AARIA → paired:**

```json
{ "type": "console.paired", "agentId": "<ariaId>", "id": "<same-or-new>", "payload": {
  "deviceId": "…", "deviceToken": "…", "expiresAt": "ISO-8601", "label": "…"
}}
```

**Web → chat:**

```json
{ "type": "chat.message", "id": "<msgId>", "agentId": "<ariaId>", "payload": {
  "message": "…", "deviceToken": "…", "deviceId": "…", "operatorId": "Alice",
  "targetAgentId": "astra-prod"   // optional; route via fleet later
}}
```

---

## Env / identity

| Variable | Purpose | Example |
|----------|---------|---------|
| `AARIA_CONSOLE_ENABLED` | Master switch | `1` |
| `AARIA_CONSOLE_ID` | Stable ariaId (contact key in web UI) | `desk-home` |
| `AARIA_CONSOLE_NAME` | Display name | `AARIA · home desk` |
| `AARIA_CONSOLE_LABELS` | Optional JSON or `k=v,k=v` | `env=home` |
| `AARIA_CONSOLE_STATUS_INTERVAL_MS` | Status heartbeat | `30000` |
| `AARIA_CONSOLE_PAIR_TTL_MS` | Pairing code window | `300000` (5 min) |
| `AARIA_CONSOLE_DEVICE_TTL_MS` | Device token lifetime | `2592000000` (30 d) |
| `AARIA_CONSOLE_STORE` | Paired-device JSON path | `.aaria/console-devices.json` |

Reuse existing `AARIA_MQTT_URL` / username / password. No second broker.

---

### Task 0: Design stub in API repo (optional but recommended)

**Files:**

- Create: `docs/superpowers/specs/2026-08-30-web-console-mqtt-bridge-design.md` (short pointer to WEB-UI specs + this plan’s contract)
- Modify: this plan only if contract drifts

- [x] Write a 1–2 page design stub: goals, topics table, auth model, non-goals (no minion-direct, no Firebase Auth)
- [x] Link WEB-UI design + auth specs by relative path note (`../MXPF-AARIA-WEB-UI/...`)

---

### Task 1: Console topics + config loader

**Files:**

- Create: `src/console/topics.ts`
- Create: `src/console/config.ts`
- Modify: `.env.example` (or split-config docs if that is the current env surface)

- [x] Export topic helpers mirroring web `TOPICS`:
  - `announce`, `status(ariaId)`, `webIn(ariaId)`, `webOut(ariaId, msgId)`, `webTyping(ariaId)`
- [x] `loadConsoleConfig()` → `null` when `AARIA_CONSOLE_ENABLED` is not truthy or `AARIA_CONSOLE_ID` missing
- [x] Resolve hostname via `os.hostname()`; version from package.json
- [x] Unit test: enabled/disabled parsing

**Acceptance:** `loadConsoleConfig()` returns null by default; with env set returns full config.

---

### Task 2: Paired-device store

**Files:**

- Create: `src/console/device-store.ts`
- Create: `src/__tests__/console-device-store.test.ts`

- [x] Persist `{ deviceId, deviceToken, label, operatorName?, pairedAt, expiresAt }` under `AARIA_CONSOLE_STORE`
- [x] APIs: `listDevices`, `upsertDevice`, `getValidDevice(deviceId|token)`, `revoke(deviceId|all)`, `purgeExpired`
- [x] Token generation: `crypto.randomBytes(32).toString("hex")`
- [x] Atomic write (temp file + rename)

**Acceptance:** Round-trip save/load; expired tokens rejected; revoke removes entry.

---

### Task 3: Pending pairing + approve/deny

**Files:**

- Create: `src/console/pairing.ts`
- Create: `src/__tests__/console-pairing.test.ts`

- [x] In-memory pending map keyed by 6-digit `code` (normalize digits only)
- [x] `registerPairRequest({ deviceId, code, label, expiresAt })` — reject duplicate active codes / stale
- [x] `approve(code)` → create device token, write store, return device record
- [x] `deny(code)` → drop pending
- [x] `listPending()` for TUI

**Acceptance:** Approve issues token with 30-day expiry; deny + expiry leave no device.

---

### Task 4: Console bridge (MQTT announce + inbox)

**Files:**

- Create: `src/console/bridge.ts`
- Create: `src/console/index.ts` (`startConsole` / `stopConsole` / `getConsoleBridge`)
- Modify: `src/fleet/index.ts` **or** `src/main.ts` — start console after fleet bus is up
- Prefer: export bus from fleet or `startConsole(bus: FleetBus)` called from `startFleet` once connected

- [x] On start (if config enabled and bus connected):
  1. Subscribe `mxpf/v1/aria/{ariaId}/web/in`
  2. Publish `aria.announce` to registry announce (retain=false, QoS 1)
  3. Start status interval → `aria.status` with `lastSeenAt`, `warm`, `name`, optional `typing`
- [x] On inbox envelope:
  - Ignore if `env.agentId !== ariaId`
  - Dispatch by `env.type`
- [x] On stop: clear interval; optional final status `offline` (nice-to-have)
- [x] Log `[console] enabled ariaId=…` / `[console] disabled`

**Wire-up recommendation:**

```ts
// after fleet bus connected in startFleet / connectOnce:
await startConsole(bus);
```

**Acceptance:** With MQTT up + console enabled, HiveMQ shows announce; web UI roster shows the desk within ~status interval without refresh if subscribed.

---

### Task 5: Handle `console.pair` → outbox

**Files:**

- Modify: `src/console/bridge.ts`
- Use: `pairing.ts`, `device-store.ts`, envelope helpers

- [x] On `console.pair`: validate `deviceId`, `code` (6 digits), `label`; register pending; log to stderr for operator visibility
- [x] Do **not** auto-approve
- [x] On TUI approve (Task 7): publish `console.paired` to `web/out/{deviceId}` or `web/out/{pairMsgId}` — **match web UI**: it listens on `web/out/#` and keys on `type === "console.paired"` (any msgId OK)
- [x] On deny: publish `console.denied` with reason

**Acceptance:** Web `startPairing` → pending on desk → approve → web `pairing.phase === "paired"` and IndexedDB session saved.

---

### Task 6: Handle `chat.message` / `chat.cancel` → agent stream

**Files:**

- Modify: `src/console/bridge.ts`
- Create: `src/console/chat-handler.ts` (keep bridge thin)
- Modify: maybe `src/debug.ts` transport union if needed (`"console"` / `"web"`)

- [x] Validate `deviceToken` via store (else `chat.error` `{ code: "unauthorized" }`)
- [x] Publish `chat.delivered` then `chat.read` quickly (web delivery ticks)
- [x] Publish `chat.typing` `{ active: true }` on typing topic
- [x] Call `handleChatTurn(agent, "web"|"console", msgId, message, onChunk)`:
  - each chunk → `chat.chunk` `{ text }` on `web/out/{msgId}`
  - final → `chat.done` `{ reply }`
- [x] On error → `chat.error` `{ message, code? }`
- [x] On cancel (`chat.cancel` or run cancel) → `chat.cancelled`; stop typing
- [x] Always clear typing `{ active: false }` in `finally`
- [x] v1: if `targetAgentId` present, either (a) prepend instruction so agent uses fleet tools, or (b) reject with clear error until fleet-route task — **prefer (a) soft pass-through** in prompt text for v1

**Agent access:** `chat-handler` needs the live `AriaAgent`. Options:

1. Pass agent into `startConsole(bus, getAgent)` from `main.ts` / `startServer`
2. Lazy import `getAgent()` from agent-manager if exported

Prefer (1) for testability.

**Acceptance:** From web, send “hello” → streaming bubbles → final reply; unauthorized token shows web error banner.

---

### Task 7: TUI `/console` commands

**Files:**

- Modify: `src/tui/commands.ts` (register `/console`)
- Modify: `src/tui/main.ts` (or ops App command router) to handle:
  - `/console` — status (enabled, ariaId, pending count, paired devices)
  - `/console pending` — list codes + labels + expiry
  - `/console pair <code>` — approve
  - `/console deny <code>`
  - `/console devices` — list paired
  - `/console revoke <deviceId|all>`
- Modify: help text / `SLASH_COMMANDS` summaries

- [x] After approve/deny, publish MQTT result via console bridge API (`bridge.approvePair(code)` etc.)
- [x] Print clear success/failure lines (no silent no-op)

**Acceptance:** Operator can pair a phone without leaving the TUI; revoke immediately blocks next chat.

---

### Task 8: Tests + smoke script

**Files:**

- Create: `src/__tests__/console-bridge.test.ts` (mock `FleetBus`)
- Create: `scripts/console-smoke.mjs` (optional) — connect with desk MQTT env, print announce once
- Modify: `package.json` test script if needed

- [x] Unit: announce payload shape, unauthorized chat, pairing approve path with fake bus
- [ ] Manual smoke checklist (below)

**Manual smoke (desk + live web):**

1. Set env on desk; restart AARIA API
2. Open https://aaria.maximprof.com → MQTT login as `web-console`
3. Roster shows **AARIA · home desk** (or configured name)
4. Select contact → if unpaired, start pairing → TUI `/console pair ######`
5. Send chat → streamed reply
6. `/console revoke all` → next message unauthorized

---

### Task 9: HiveMQ ACL + ops docs

**Files:**

- Modify: `README.md` (console section) **or** create `docs/CONSOLE.md`
- Modify: `.env.example`

- [x] Document desk needs publish: `mxpf/v1/aria/registry/announce`, `mxpf/v1/aria/{id}/status`, `mxpf/v1/aria/{id}/web/out/#`
- [x] Document desk needs subscribe: `mxpf/v1/aria/{id}/web/in`
- [x] Document browser `web-console` ACL: SUB `mxpf/v1/aria/#`, PUB `mxpf/v1/aria/+/web/in`, DENY agents/#
- [x] Note: empty roster = console disabled or wrong `AARIA_CONSOLE_ID` / ACL

---

## Suggested implementation order

```
Task 1 (topics/config)
  → Task 2 (device store)
  → Task 3 (pairing)
  → Task 4 (bridge announce+status+subscribe)
  → Task 5 (pair outbox)
  → Task 6 (chat stream)   ← first “hello” works
  → Task 7 (TUI)
  → Task 8 (tests)
  → Task 9 (docs)
```

**Minimum to fill the roster (shippable slice):** Tasks **1 + 4** only.  
**Minimum for daily chat:** Tasks **1–7**.

---

## Out of scope (later)

- Per-operator HiveMQ users
- PIN unlock / encrypted MQTT password vault
- Web-driven fleet approve/exec UI (chat-only first)
- Publishing minion roster into the web UI as separate contacts
- Firebase Auth / custom backend

---

## Definition of done

- [ ] With console enabled, web roster shows this desk within 30s of API start
- [ ] Pairing via 6-digit code + `/console pair` works end-to-end
- [ ] Chat streams chunks and completes with `chat.done`
- [ ] Revoke / expired token → `chat.error` unauthorized
- [ ] Fleet/minion plane unchanged (existing fleet tests still pass)
- [ ] Plan checkboxes updated as tasks complete

---

## File map (target)

| Path | Role |
|------|------|
| `src/console/topics.ts` | Topic constants |
| `src/console/config.ts` | Env loader |
| `src/console/device-store.ts` | Paired devices persistence |
| `src/console/pairing.ts` | Pending codes |
| `src/console/chat-handler.ts` | chat.message → handleChatTurn |
| `src/console/bridge.ts` | MQTT subscribe/publish orchestration |
| `src/console/index.ts` | start/stop exports |
| `src/tui/commands.ts` + TUI router | `/console …` |
| `src/main.ts` / `src/fleet/index.ts` | Lifecycle hook |
| `docs/superpowers/plans/2026-08-30-web-console-mqtt-bridge.md` | This plan |
| `docs/superpowers/specs/2026-08-30-web-console-mqtt-bridge-design.md` | Optional design stub |
