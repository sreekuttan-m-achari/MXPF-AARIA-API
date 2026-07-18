# ASTRA Slice A — Fleet Executor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working ASTRA executor minion and AARIA fleet bridge over HiveMQ so AARIA can approve a pending agent and run allowlisted `cmd.exec` jobs on it.

**Architecture:** Both sides dial outbound MQTT (HiveMQ default). Shared JSON envelope on `mxpf/v1/*` topics. ASTRA announces → AARIA approves (app-level registry; MQTT users pre-created in HiveMQ) → AARIA publishes `cmd.exec` → ASTRA runs core caps → publishes result. No Cursor SDK on the minion in this slice.

**Tech Stack:** Node.js ≥ 22.13, TypeScript, `tsx`, `mqtt`, `zod`, `dotenv`, `node:test` via `tsx --test` (same pattern as AARIA).

## Global Constraints

- Node.js ≥ 22.13; `"type": "module"`; TypeScript `module`/`moduleResolution` = `NodeNext`
- HiveMQ is the **default** hub; Mosquitto Compose remains optional docs only (no required ops in Slice A)
- No `CURSOR_API_KEY` on ASTRA in Slice A (`ASTRA_BRAIN` stays off / unimplemented)
- Never commit `.env` or real MQTT passwords; passwords that start with `#` must be quoted in dotenv
- Protocol prefix `mxpf/v1`; envelope `{ v: 1, type, id, ts, agentId, payload }`
- Core caps only: `health`, sandboxed `exec` (cwd + timeout + max output); no docker/nginx/k8s packs yet
- Result log bodies capped at 64 KiB
- QoS 1 for registry / cmd / result
- HiveMQ free tier cannot mint MQTT users via API — registration **approves identity + caps**; MQTT username/password are pre-provisioned (e.g. `mxpfastra`)
- Keep files small and single-purpose; match AARIA style (`src/*.ts`, `.js` import suffixes)

## File map

### `MXPF-ASTRA-AGENT` (greenfield)

| Path | Responsibility |
|------|----------------|
| `package.json`, `tsconfig.json`, `.nvmrc` | Project scaffold |
| `src/config.ts` | Env → typed config (zod) |
| `src/protocol/envelope.ts` | Envelope parse/serialize |
| `src/protocol/topics.ts` | Topic helpers |
| `src/mqtt/bus.ts` | Connect, pub/sub, reconnect |
| `src/registry/lifecycle.ts` | Announce + wait for approve |
| `src/caps/types.ts` | Cap interface |
| `src/caps/health.ts` | `health` action |
| `src/caps/exec.ts` | Sandboxed shell exec |
| `src/caps/index.ts` | Registry of enabled caps |
| `src/jobs/handler.ts` | Handle `cmd.exec` → result |
| `src/state.ts` | Approved assignment persistence (`data/assignment.json`) |
| `src/main.ts` | Boot loop |
| `src/__tests__/*.test.ts` | Unit tests |
| `SOUL.sample.md`, `OBJECTIVES.sample.md`, `ENV.sample.md` | Thin persona pack samples |
| `README.md` | Update with run instructions |

### `MXPF-AARIA-API` (fleet bridge)

| Path | Responsibility |
|------|----------------|
| `src/fleet/config.ts` | `AARIA_MQTT_*` config |
| `src/fleet/topics.ts` | Same topic helpers (keep in sync with ASTRA) |
| `src/fleet/envelope.ts` | Same envelope helpers |
| `src/fleet/bus.ts` | MQTT client |
| `src/fleet/registry-store.ts` | Pending + approved agents (JSON under `data/fleet/`) |
| `src/fleet/fleet-md.ts` | Rewrite `FLEET.md` roster table on approve |
| `src/fleet/bridge.ts` | Subscribe pending/status/result; publish approve/cmd |
| `src/fleet/index.ts` | start/stop from `main.ts` |
| `src/ws.ts` | HTTP: `GET /fleet/agents`, `POST /fleet/approve`, `POST /fleet/cmd` |
| `src/__tests__/fleet-*.test.ts` | Unit tests |
| `package.json` | Add `mqtt` dependency |

---

### Task 1: Scaffold `MXPF-ASTRA-AGENT` package

**Files:**
- Create: `MXPF-ASTRA-AGENT/package.json`
- Create: `MXPF-ASTRA-AGENT/tsconfig.json`
- Create: `MXPF-ASTRA-AGENT/.nvmrc`
- Modify: `MXPF-ASTRA-AGENT/README.md` (run section)

**Interfaces:**
- Consumes: nothing
- Produces: runnable `npm test` / `npm start` scripts

- [ ] **Step 1: Write package.json**

```json
{
  "name": "astra-agent",
  "private": true,
  "type": "module",
  "version": "0.1.0",
  "engines": { "node": ">=22.13" },
  "scripts": {
    "start": "tsx src/main.ts",
    "dev": "tsx watch src/main.ts",
    "test": "tsx --test src/__tests__/**/*.test.ts"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "mqtt": "^5.10.0",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Write tsconfig.json and .nvmrc**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts"]
}
```

`.nvmrc` contents: `22`

- [ ] **Step 3: Install deps**

Run: `cd /home/sreekuttan/WORKS/AARIA/MXPF-ASTRA-AGENT && npm install`  
Expected: `package-lock.json` created; exit 0

- [ ] **Step 4: Commit**

```bash
cd /home/sreekuttan/WORKS/AARIA/MXPF-ASTRA-AGENT
git init  # only if not already a repo
git add package.json package-lock.json tsconfig.json .nvmrc .gitignore .env.sample README.md docs deploy
git commit -m "$(cat <<'EOF'
chore: scaffold ASTRA agent package for fleet executor

EOF
)"
```

---

### Task 2: Protocol envelope + topics (ASTRA)

**Files:**
- Create: `src/protocol/envelope.ts`
- Create: `src/protocol/topics.ts`
- Create: `src/__tests__/envelope.test.ts`

**Interfaces:**
- Produces:
  - `parseEnvelope(raw: string | Buffer): FleetEnvelope`
  - `serializeEnvelope(env: FleetEnvelope): string`
  - `topics.announce`, `topics.pending(agentId)`, `topics.approve(agentId)`, `topics.cmd(agentId)`, `topics.status(agentId)`, `topics.result(agentId, jobId)`

- [ ] **Step 1: Write failing tests**

```typescript
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEnvelope, serializeEnvelope } from "../protocol/envelope.js";
import { topics } from "../protocol/topics.js";

test("round-trips envelope", () => {
  const env = {
    v: 1 as const,
    type: "cmd.exec",
    id: "job-1",
    ts: "2026-07-18T00:00:00.000Z",
    agentId: "astra-web-prod",
    payload: { action: "health", args: {} },
  };
  const again = parseEnvelope(serializeEnvelope(env));
  assert.deepEqual(again, env);
});

test("rejects wrong version", () => {
  assert.throws(() =>
    parseEnvelope(JSON.stringify({ v: 2, type: "x", id: "1", ts: "t", agentId: "a", payload: {} })),
  );
});

test("topic helpers", () => {
  assert.equal(topics.cmd("astra-web-prod"), "mxpf/v1/agents/astra-web-prod/cmd");
  assert.equal(topics.result("astra-web-prod", "job-1"), "mxpf/v1/agents/astra-web-prod/result/job-1");
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test`  
Expected: FAIL (module not found)

- [ ] **Step 3: Implement envelope + topics**

```typescript
// src/protocol/topics.ts
const PREFIX = "mxpf/v1";

export const topics = {
  announce: `${PREFIX}/registry/announce`,
  pending: (agentId: string) => `${PREFIX}/registry/pending/${agentId}`,
  approve: (agentId: string) => `${PREFIX}/registry/approve/${agentId}`,
  cmd: (agentId: string) => `${PREFIX}/agents/${agentId}/cmd`,
  status: (agentId: string) => `${PREFIX}/agents/${agentId}/status`,
  result: (agentId: string, jobId: string) =>
    `${PREFIX}/agents/${agentId}/result/${jobId}`,
  event: (agentId: string) => `${PREFIX}/agents/${agentId}/event`,
  reply: (agentId: string, msgId: string) =>
    `${PREFIX}/agents/${agentId}/reply/${msgId}`,
} as const;
```

```typescript
// src/protocol/envelope.ts
import { z } from "zod";

export const FleetEnvelopeSchema = z.object({
  v: z.literal(1),
  type: z.string().min(1),
  id: z.string().min(1),
  ts: z.string().min(1),
  agentId: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

export type FleetEnvelope = z.infer<typeof FleetEnvelopeSchema>;

export function parseEnvelope(raw: string | Buffer): FleetEnvelope {
  const text = typeof raw === "string" ? raw : raw.toString("utf8");
  return FleetEnvelopeSchema.parse(JSON.parse(text));
}

export function serializeEnvelope(env: FleetEnvelope): string {
  return JSON.stringify(FleetEnvelopeSchema.parse(env));
}

export function makeEnvelope(
  type: string,
  agentId: string,
  payload: Record<string, unknown>,
  id: string = crypto.randomUUID(),
): FleetEnvelope {
  return {
    v: 1,
    type,
    id,
    ts: new Date().toISOString(),
    agentId,
    payload,
  };
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/protocol src/__tests__/envelope.test.ts
git commit -m "$(cat <<'EOF'
feat: add mxpf/v1 fleet envelope and topic helpers

EOF
)"
```

---

### Task 3: ASTRA config + assignment state

**Files:**
- Create: `src/config.ts`
- Create: `src/state.ts`
- Create: `src/__tests__/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(): AstraConfig`, `loadAssignment()` / `saveAssignment(a)`

- [ ] **Step 1: Write failing config test**

```typescript
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseConfig } from "../config.js";

test("parses hive mqtt url and quoted password", () => {
  const cfg = parseConfig({
    ASTRA_MQTT_PROVIDER: "hivemq",
    ASTRA_MQTT_URL: "mqtts://example.hivemq.cloud:8883",
    ASTRA_MQTT_USERNAME: "mxpfastra",
    ASTRA_MQTT_PASSWORD: "#secret",
    ASTRA_AGENT_ID: "astra-web-prod",
    ASTRA_AGENT_NAME: "web-prod",
  });
  assert.equal(cfg.mqtt.provider, "hivemq");
  assert.equal(cfg.mqtt.password, "#secret");
  assert.equal(cfg.agentId, "astra-web-prod");
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement config + state**

```typescript
// src/config.ts — zod object from process.env / injected record
// Required: MQTT url, username, password, agentId
// Optional: agentName, sandboxRoot (default process.cwd()), execTimeoutMs (default 30000)

// src/state.ts — data/assignment.json
// { approved: boolean, labels: Record<string,string>, caps: string[], approvedAt?: string }
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit** — `feat: add ASTRA config and assignment persistence`

---

### Task 4: Core capability packs (`health` + `exec`)

**Files:**
- Create: `src/caps/types.ts`, `health.ts`, `exec.ts`, `index.ts`
- Create: `src/__tests__/caps.test.ts`

**Interfaces:**
- Produces: `runCap(action: string, args: Record<string, unknown>, ctx: CapContext): Promise<CapResult>`
- `health` → `{ ok, hostname, uptime, load, freemem, totalmem }`
- `exec` → `{ code, stdout, stderr }` with cwd confined under `sandboxRoot`, timeout, 64 KiB truncate

- [ ] **Step 1: Write failing tests** for health shape and exec rejection outside sandbox

```typescript
test("exec rejects path escape", async () => {
  await assert.rejects(() =>
    runCap("exec", { cmd: "pwd", cwd: "/tmp/../etc" }, ctx),
  );
});

test("health returns hostname", async () => {
  const r = await runCap("health", {}, ctx);
  assert.equal(r.ok, true);
  assert.ok((r.data as { hostname: string }).hostname);
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement caps**

Use `node:child_process` `execFile` with `shell: false` where possible; for shell strings use `bash -lc` only when `args.shell === true` and still under timeout. Default: `execFile("/bin/bash", ["-lc", cmd], { cwd, timeout, maxBuffer })` with cwd resolved + `startsWith(sandboxRoot)`.

Truncate stdout/stderr to 64 * 1024 chars.

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit** — `feat: add core health and sandboxed exec caps`

---

### Task 5: MQTT bus + registry lifecycle + job handler (ASTRA)

**Files:**
- Create: `src/mqtt/bus.ts`
- Create: `src/registry/lifecycle.ts`
- Create: `src/jobs/handler.ts`
- Create: `src/main.ts`
- Create: `src/__tests__/jobs-handler.test.ts` (unit, mock bus)

**Interfaces:**
- `createBus(cfg): { publish, subscribe, end }`
- `startLifecycle(bus, cfg, state)` — publish announce to `topics.announce` and `topics.pending(id)`; subscribe `topics.approve(id)`; on approve save assignment and subscribe `topics.cmd(id)`
- `handleCmd(env, caps, bus)` — only if approved; only `cmd.exec`; publish result

Announce payload:

```json
{
  "name": "web-prod",
  "registrationToken": optional,
  "labels": { "env": "prod", "role": "web" },
  "caps": ["health", "exec"],
  "hostname": "...",
  "version": "0.1.0"
}
```

Approve payload:

```json
{
  "approved": true,
  "labels": { "env": "prod", "role": "web" },
  "caps": ["health", "exec"]
}
```

- [ ] **Step 1: Unit-test job handler with fake bus** (array of publishes)

- [ ] **Step 2: Implement bus with `mqtt.connect(url, { username, password, protocolVersion: 5, reconnectPeriod: 2000 })`**

- [ ] **Step 3: Implement lifecycle + handler + main**

`main.ts` outline:

```typescript
import "dotenv/config";
import { loadConfig } from "./config.js";
import { createBus } from "./mqtt/bus.js";
import { startLifecycle } from "./registry/lifecycle.js";
import { loadAssignment } from "./state.js";

const cfg = loadConfig();
const bus = await createBus(cfg);
await startLifecycle(bus, cfg, loadAssignment());
// process signals → bus.end()
```

- [ ] **Step 4: Manual smoke (optional if HiveMQ reachable)**

Run ASTRA with existing `.env`; expect log `announced` then wait.

- [ ] **Step 5: Commit** — `feat: connect MQTT bus, announce, and execute cmd.exec`

---

### Task 6: AARIA fleet protocol + config (mirror)

**Files:**
- Create: `MXPF-AARIA-API/src/fleet/topics.ts` (copy of ASTRA topics)
- Create: `MXPF-AARIA-API/src/fleet/envelope.ts` (copy of ASTRA envelope)
- Create: `MXPF-AARIA-API/src/fleet/config.ts`
- Create: `MXPF-AARIA-API/src/__tests__/fleet-envelope.test.ts`
- Modify: `MXPF-AARIA-API/package.json` — add `"mqtt": "^5.10.0"`

**Interfaces:** Same as ASTRA topics/envelope; `loadFleetMqttConfig(): FleetMqttConfig | null` (returns null if `AARIA_MQTT_URL` unset — fleet disabled)

- [ ] **Step 1: Add mqtt dependency** — `npm install mqtt` in AARIA API

- [ ] **Step 2: Copy/adapt envelope+topics tests + implementation**

- [ ] **Step 3: Implement `loadFleetMqttConfig`** reading `AARIA_MQTT_*`

- [ ] **Step 4: `npm test` — new tests PASS; existing tests still PASS**

- [ ] **Step 5: Commit** — `feat: add fleet MQTT config and shared envelope helpers`

---

### Task 7: AARIA registry store + FLEET.md writer

**Files:**
- Create: `src/fleet/registry-store.ts`
- Create: `src/fleet/fleet-md.ts`
- Create: `src/__tests__/fleet-registry.test.ts`

**Interfaces:**
- `upsertPending(agent)`, `approve(agentId, labels, caps)`, `listAgents()`, `getAgent(id)`
- Persist under `data/fleet/agents.json` (gitignored)
- `syncFleetMarkdown(agents)` updates the minions table in `FLEET.md` between markers:

```markdown
<!-- FLEET:BEGIN -->
| Agent ID | ...
<!-- FLEET:END -->
```

Update `FLEET.md` to include those markers around the table.

- [ ] **Step 1: Tests for approve moves pending → approved and rewrites markdown**

- [ ] **Step 2: Implement store + markdown sync**

- [ ] **Step 3: PASS + commit** — `feat: persist fleet registry and sync FLEET.md`

---

### Task 8: AARIA fleet bridge + HTTP API + main wiring

**Files:**
- Create: `src/fleet/bus.ts`, `bridge.ts`, `index.ts`
- Modify: `src/main.ts` — `startFleetBridge()` / `stopFleetBridge()`
- Modify: `src/ws.ts` — routes below
- Create: `src/__tests__/fleet-bridge-handler.test.ts`

**HTTP API:**

| Method | Path | Body | Behaviour |
|--------|------|------|-----------|
| `GET` | `/fleet/agents` | — | pending + approved |
| `GET` | `/fleet/health` | — | `{ enabled, connected }` |
| `POST` | `/fleet/approve` | `{ "agentId", "labels?", "caps?" }` | save + publish approve |
| `POST` | `/fleet/cmd` | `{ "agentId", "action", "args?" }` | publish `cmd.exec`; return `{ jobId }` |

Bridge behaviour:
- If config null → log `[fleet] disabled` and no-op
- Subscribe `mxpf/v1/registry/announce` and `mxpf/v1/registry/pending/+`
- On announce → upsert pending
- Subscribe `mxpf/v1/agents/+/status` and `+/result/+` (log + store last status)
- `approve` → publish approve envelope + sync FLEET.md
- `cmd` → publish to `topics.cmd(agentId)`

- [ ] **Step 1: Implement bridge + wire main/ws**

- [ ] **Step 2: Unit-test approve/cmd publish shaping**

- [ ] **Step 3: Restart AARIA; `curl /fleet/health` → `{ enabled: true, ... }` when env set**

- [ ] **Step 4: Commit** — `feat: wire AARIA fleet MQTT bridge and HTTP API`

---

### Task 9: End-to-end smoke + docs

**Files:**
- Modify: both READMEs (Slice A runbook)
- Modify: `FLEET.md` markers
- Modify: design spec status → `Accepted — Slice A plan`

- [ ] **Step 1: E2E checklist (manual)**

1. Ensure HiveMQ users `mxpfaaria` / `mxpfastra` exist (Publish and Subscribe)
2. Start AARIA (`npm start`) — log `[fleet] connected`
3. Start ASTRA with `ASTRA_AGENT_ID=astra-demo` — log `announced`
4. `curl -s http://127.0.0.1:8788/fleet/agents` — see pending `astra-demo`
5. `curl -s -X POST http://127.0.0.1:8788/fleet/approve -H 'content-type: application/json' -d '{"agentId":"astra-demo","labels":{"env":"lab"},"caps":["health","exec"]}'`
6. `curl -s -X POST http://127.0.0.1:8788/fleet/cmd -H 'content-type: application/json' -d '{"agentId":"astra-demo","action":"health"}'`
7. Confirm AARIA logs result (or add `GET /fleet/jobs/:id` if implemented in bridge store); confirm ASTRA logs exec

- [ ] **Step 2: Document the curl flow in both READMEs**

- [ ] **Step 3: Commit** — `docs: Slice A runbook and FLEET markers`

---

## Out of scope (later slices)

- Slice B: periodic heartbeats, proactive `event`, watchdog thresholds
- Slice C: `ASTRA_BRAIN=1` + Cursor SDK on minion
- Mosquitto Compose production hardening / per-topic ACLs
- TUI `/fleet` commands (HTTP is enough for Slice A)
- Auto-minting HiveMQ users
- Capability packs `docker` / `nginx` / `k8s`
- `chat.message` proxy path (desk brain → tools); can follow immediately after Slice A as a thin Task 10 if needed

## Spec coverage check

| Spec item | Task |
|-----------|------|
| HiveMQ default outbound hub | 5, 6, 8 |
| Per-minion identity (app registry) | 3, 7 |
| Register → approve | 5, 8 |
| `cmd.exec` + core caps | 4, 5, 8 |
| Envelope / topics | 2, 6 |
| FLEET.md awareness | 7 |
| No Cursor on minion | Global / out of scope C |
| Mosquitto optional only | Docs only |

## Placeholder scan

No TBD steps; HiveMQ user minting explicitly deferred with pre-provisioned creds.

---

**Plan complete.** Saved to:

- `MXPF-ASTRA-AGENT/docs/superpowers/plans/2026-07-18-astra-slice-a.md`
- (copy) `MXPF-AARIA-API/docs/superpowers/plans/2026-07-18-astra-slice-a.md`
