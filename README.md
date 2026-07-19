# A.A.R.I.A. — Augmented Adaptive Reasoning Intelligence Assistant

> The work-desk intelligence of the workstation. Precise, calm, and mission-focused —
> a feminine presence that is confident without being cold, in the spirit of Tony
> Stark's F.R.I.D.A.Y.

**AARIA** (always two A's — **A**·**A**·RIA, short form *ARIA*) is a local, Cursor-SDK
powered assistant that lives in your terminal and runs as a background service. She owns
the **professional lane**: code, DevOps, servers, infrastructure, and planning. Her
sibling **Amelia** owns the **home lane** (personal life + Home Assistant). Her
**ASTRA** minions (*Autonomous Site Task & Response Agent*) hold remote VPS/K8s sites
over an MQTT hub. AARIA hands home/personal requests to Amelia and keeps the work desk
(and fleet command) for herself.

```
┌──────────────────────────────┐        ┌──────────────────────────────┐
│  ARIA  ·  work lane           │        │  Amelia  ·  home lane         │
│  MXPF-AARIA-API   (port 8788) │        │  amelia-widget    (port 8787) │
│  code · devops · fleet cmd    │        │  personal · Home Assistant    │
└──────────────┬───────────────┘        └──────────────┬───────────────┘
               │  Cursor SDK (desk)                     │  Cursor SDK
               ▼                                        ▼
        ┌─────────────────────────────────────────────────────┐
        │  Cursor platform  ·  MCP tools (memory, HA, fetch)    │
        └──────────────────────────┬──────────────────────────┘
                                   │ MQTT (HiveMQ default)
                                   ▼
                    ┌──────────────────────────┐
                    │  ASTRA minions (remote)   │
                    │  MXPF-ASTRA-AGENT         │
                    └──────────────────────────┘
```

---

## About & purpose

AARIA is a thin, opinionated backend around the [`@cursor/sdk`](https://www.npmjs.com/package/@cursor/sdk)
agent runtime, plus a terminal client (TUI). The goals:

- **A dedicated work assistant** — separate identity, persona, memory, and port from
  Amelia so the two never step on each other.
- **Always-on** — runs as a `systemd` user service (host) or a container, warms the agent
  on boot, and resumes the same agent session across restarts.
- **Terminal-native** — the `aaria` command opens a live REPL with streaming replies,
  slash-command autocomplete, and inline suggestions.
- **Tool-capable** — optional MCP servers (persistent memory, Home Assistant REST, web
  fetch) extend what she can do.

### Persona

- **Formal designation:** A.A.R.I.A. — *Augmented Adaptive Reasoning Intelligence Assistant*
- **Temperament:** precise, calm, mission-focused; warm but not chatty.
- **Lane:** work / professional. Delegates home + Home Assistant to Amelia.

Persona is data-driven — edit `SOUL.md` (who she is), `USER.md` (who you are), and
`FLEET.md` (ASTRA minion roster). Samples are provided as `SOUL.sample.md` /
`USER.sample.md` / `FLEET.sample.md`. Fleet ops skill: `skills/astra-fleet/`.

---

## Architecture

| Piece | File(s) | Role |
|-------|---------|------|
| **API server** | `src/main.ts`, `src/ws.ts` | HTTP + WebSocket endpoints, warmup, stale-run cleanup |
| **Agent** | `src/agent-manager.ts`, `src/agent.ts` | Boots the Cursor SDK agent, local store, session resume |
| **Chat** | `src/chat.ts`, `src/stream.ts`, `src/runs.ts` | Turn handling and token streaming |
| **Persona** | `src/persona.ts` | Loads `SOUL.md` / `USER.md` / `MEMORY.md` / `FLEET.md`, working dir |
| **Learn loop** | `src/learn/*.ts` | Post-turn review → `MEMORY.md` / `USER.md` (Hermes-style) |
| **Scheduler** | `src/scheduler/*.ts` | Heartbeat, interval/cron jobs, `/jobs` API |
| **Fleet** | *(planned)* `src/fleet/*` | MQTT bridge to ASTRA minions (HiveMQ default) |
| **MCP** | `src/config/mcp.ts` | Loads `.cursor/mcp.json` tool servers |
| **TUI** | `src/tui/*.ts` | `aaria` terminal client (REPL, completion, auto-start) |
| **Deploy** | `deploy/*`, `bin/aaria` | systemd / LaunchAgent / Windows task + CLI installer |

### API endpoints (default `http://127.0.0.1:8788`)

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/health` | Status: name, version, session id, warm flag, greeting, persona/MCP/memory stats, scheduler summary |
| `GET`  | `/cursor` | Cursor API config (model, masked key), account, token usage, available models |
| `GET`  | `/fleet/health` | Fleet MQTT bridge status (`enabled`, `connected`) |
| `GET`  | `/fleet/agents` | Pending + approved ASTRA minions |
| `POST` | `/fleet/approve` | `{ "agentId", "labels?", "caps?" }` — approve minion |
| `POST` | `/fleet/cmd` | `{ "agentId", "action", "args?" }` — dispatch `cmd.exec` |
| `GET`  | `/heartbeat` | Last in-process heartbeat snapshot (RAM, load, warnings) |
| `GET`  | `/jobs` | All configured jobs with last/next run state |
| `POST` | `/jobs/run` | `{ "id": "heartbeat" }` — run a job immediately |
| `POST` | `/jobs/reload` | Reload `jobs.json` without restarting the service |
| `GET`  | `/memory/pending` | Staged learn entries (when `AARIA_LEARN_APPROVAL=1`) |
| `POST` | `/memory/approve` | `{ "id": "abc" \| "all" }` — apply staged entries |
| `POST` | `/memory/reject` | `{ "id": "abc" \| "all" }` — discard staged entries |
| `POST` | `/chat` | `{ "message": "...", "id": "..." }` → `{ "reply": "..." }` |
| `POST` | `/chat/stream` | Same body → `text/event-stream` of `chunk` events, then `done` |
| `POST` | `/chat/cancel` | `{ "id": "..." }` → cancels an in-flight reply |
| `WS`   | `/` | WebSocket transport used by the TUI |

---

## Requirements & dependencies

**Runtime**

- **Node.js ≥ 22.13** (uses the built-in `node:sqlite` for the local agent store; see `.nvmrc` → Node 22).
- A **Cursor account/subscription** and a **`CURSOR_API_KEY`** (the SDK talks to the Cursor platform).

**npm dependencies** (installed via `npm install`)

- `@cursor/sdk` — agent runtime
- `@modelcontextprotocol/sdk`, `@modelcontextprotocol/server-memory` — MCP + bundled memory server
- `ws` — WebSocket server
- `node-cron` — cron expressions for scheduled jobs
- `dotenv` — env loading
- `zod` — validation
- dev: `tsx` (runs the TS sources), `typescript`, `@types/*`

**Optional**

- **`uv` / `uvx`** — only needed if you enable the bundled `mcp-server-fetch` MCP. The
  Docker image already includes it.
- **Docker + Docker Compose** — for the containerized deployment.
- **A Home Assistant** instance + long-lived token — for the Home Assistant REST MCP.

---

## Installation

Clone/enter the project, then choose **host** or **Docker**.

**Quick path (recommended):** run the guided installer — prerequisites, `.env`, persona
files, CLI, background service (Linux/Windows), and health checks in one flow:

```bash
# Linux / macOS (same script)
bash deploy/install-upgrade.sh
# keep local .env / SOUL / USER / MEMORY and redeploy deps:
bash deploy/install-upgrade.sh --reinstall
```

```powershell
# Windows (PowerShell 5.1+)
powershell -NoProfile -ExecutionPolicy Bypass -File deploy\install-upgrade.ps1
# or: npm run install:win
# reinstall: npm run install:reinstall:win
```

### 1. Configure (manual alternative)

```bash
cp .env-sample .env
# edit .env → set CURSOR_API_KEY (required)

cp SOUL.sample.md SOUL.md      # optional: customise the persona
cp USER.sample.md USER.md      # optional: tell her about you
cp MEMORY.sample.md MEMORY.md  # optional: seed agent memory (learn loop appends here)
cp .cursor/mcp.json.sample .cursor/mcp.json   # optional: enable MCP tools (incl. memory)
```

### 2a. Run on Linux (systemd user service)

```bash
nvm install && nvm use          # Node 22 (from .nvmrc)
npm install

# one-off foreground run:
npm start                       # → http://127.0.0.1:8788

# or install as an always-on user service:
bash deploy/install-service.sh
systemctl --user status aria-api.service
journalctl --user -u aria-api.service -f
```

Install the `aaria` terminal command:

```bash
npm run install-cli             # symlinks aaria → ~/.local/bin/aaria
aaria                           # opens the TUI (auto-starts the service if down)
```

### 2a-mac. Run on macOS (host)

Same guided installer as Linux. On macOS the background API is a **LaunchAgent**
(`com.aaria.api`) instead of systemd.

Requires **Node.js ≥ 22.13** (nvm or Homebrew), and `~/.local/bin` on PATH (zsh):

```bash
# Guided install (recommended) — installs LaunchAgent in Step 7
bash deploy/install-upgrade.sh
# or: npm run install

# Or step by step:
npm install
cp .env-sample .env             # set CURSOR_API_KEY
cp SOUL.sample.md SOUL.md
cp USER.sample.md USER.md
cp MEMORY.sample.md MEMORY.md
npm run install-cli             # aaria → ~/.local/bin
bash deploy/install-service.sh  # LaunchAgent com.aaria.api

# PATH for zsh (default shell on modern macOS)
grep -q '.local/bin' ~/.zshrc 2>/dev/null || \
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

# TUI (auto-starts LaunchAgent if the API is down)
aaria

curl -s http://127.0.0.1:8788/health | python3 -m json.tool
launchctl print gui/$(id -u)/com.aaria.api
tail -f ~/Library/Logs/aaria/aria-api.err.log
```

Reinstall without touching local config:

```bash
bash deploy/install-upgrade.sh --reinstall
```

> **Note:** `install-service.sh` / `install-heartbeat-timer.sh` are Linux/systemd only.
> On macOS the in-process job scheduler covers heartbeats; optional: cron `curl` to `/jobs/run`.
> See `deploy/README.md` for the full platform matrix.

### 2a-win. Run on Windows (host)

Requires **Node.js ≥ 22.13**, **Windows Terminal** (recommended), and PowerShell 5.1+.

```powershell
# Guided install (recommended)
npm run install:win

# Or step by step:
npm install
copy .env-sample .env          # set CURSOR_API_KEY
copy SOUL.sample.md SOUL.md
copy USER.sample.md USER.md
copy MEMORY.sample.md MEMORY.md
npm run install-cli:win        # aaria → %USERPROFILE%\.local\bin
npm run install-service:win    # optional: ARIA-API scheduled task at logon
npm run install-heartbeat:win  # optional: external heartbeat every 5m

npm start                      # foreground API on http://127.0.0.1:8788
aaria                          # TUI (new terminal after PATH update)
```

| Linux | macOS | Windows |
|-------|-------|---------|
| `bash deploy/install-upgrade.sh` | same | `npm run install:win` |
| `bash deploy/install-upgrade.sh --reinstall` | same | `npm run install:reinstall:win` |
| `bash deploy/install-service.sh` | same (LaunchAgent) | `npm run install-service:win` |
| `bash deploy/install-heartbeat-timer.sh` | in-process / cron | `npm run install-heartbeat:win` |
| `npm run install-cli` | same | `npm run install-cli:win` |
| `systemctl --user start aria-api.service` | `launchctl kickstart -k gui/$(id -u)/com.aaria.api` | `Start-ScheduledTask -TaskName ARIA-API` |
| `journalctl --user -u aria-api.service -f` | `tail -f ~/Library/Logs/aaria/aria-api.err.log` | Task Scheduler → **ARIA-API** |
| `~/.local/bin` on PATH | `~/.local/bin` in `~/.zshrc` | `%USERPROFILE%\.local\bin` on user PATH |

> **Note:** The TUI auto-starts the background service when the API is down — systemd on
> Linux, LaunchAgent `com.aaria.api` on macOS, and the Windows scheduled task after
> `install-service:win`.

### 2b. Run with Docker

The image runs the API via `tsx`; the same image also provides the TUI.

```bash
cp .env-sample .env             # set CURSOR_API_KEY

# build + start the API (detached)
docker compose up -d --build

# health
curl -s http://127.0.0.1:8788/health | python3 -m json.tool

# open the TUI (uses the `tui` profile; connects over the compose network)
docker compose run --rm tui

# or drop into the already-running API container
docker compose exec aaria-api aaria

# logs / lifecycle
docker compose logs -f aaria-api
docker compose down
```

> **Port note:** the container publishes `127.0.0.1:8788`. Don't run the host
> `aria-api.service` and the container at the same time — they'd fight over 8788. Use one
> or the other (`systemctl --user stop aria-api.service` before `docker compose up`).

**Persistence:** the agent's session id and local store live under `$HOME/.cursor` inside
the container, persisted in the named volume `aaria-state`. Removing it (`docker compose
down -v`) starts a fresh agent session.

---

## Configuration

All settings are environment variables (see `.env-sample`). Common ones:

| Variable | Default | Purpose |
|----------|---------|---------|
| `CURSOR_API_KEY` | — | **Required.** Cursor platform key |
| `AARIA_MODEL` | `default` (Auto) | Cursor model id (`default`, `composer-2`, `composer-2.5`, …). List with SDK `Cursor.models.list` |
| `AARIA_LEARN_MODEL` | same as `AARIA_MODEL` default (`default`) | Model for learn/curator agent |
| `AARIA_WS_HOST` | `127.0.0.1` (`0.0.0.0` in Docker) | Bind address |
| `AARIA_WS_PORT` | `8788` | HTTP/WS port |
| `AARIA_API_URL` | `http://127.0.0.1:8788` | Base URL the TUI/health client dials |
| `AARIA_OPS` | on | Set `0` to disable ops overlay (`/ops`, Ctrl+O) |
| `AARIA_AGENT_CWD` | server cwd | Working directory for the agent |
| `AGENT_SOUL_PATH` | `./SOUL.md` | Persona file |
| `AGENT_USER_PATH` | `./USER.md` | User profile file |
| `AARIA_SESSION_DIR` | under SDK state root | Where the resumable session id is stored |
| `AARIA_AGENT_STORE_DIR` | under SDK state root | Store dir (JSONL fallback on Node < 22.13) |
| `AARIA_SYSTEMD_SERVICE` | `aria-api.service` | Service the TUI auto-starts |
| `AARIA_MCP_ENABLED` | on if `mcp.json` present | Set `0` to disable MCP |
| `MCP_CONFIG_PATH` | `.cursor/mcp.json` | MCP config location |
| `HA_BASE_URL` / `HA_MCP_HTTP_URL` / `HA_API_ACCESS_TOKEN` | — | Home Assistant MCP |
| `AARIA_DEBUG` / `AARIA_DEBUG_STREAM` / `AARIA_DEBUG_LOG` | off | Verbose conversation logging |
| `AARIA_LEARN_REVIEW` | on | Post-turn background review (set `0` to disable) |
| `AARIA_LEARN_APPROVAL` | off | Stage learn writes; approve in TUI with `/memory approve` |
| `AARIA_MEMORY_CHAR_LIMIT` | `2200` | Max chars in `MEMORY.md` |
| `AGENT_MEMORY_PATH` | `./MEMORY.md` | Agent memory file |
| `AARIA_SCHEDULER` | on | In-process job scheduler (set `0` to disable) |
| `AARIA_JOBS_PATH` | `./jobs.json` | Job definitions (see `jobs.sample.json`) |
| `AARIA_HEARTBEAT` | on | Built-in heartbeat when `jobs.json` is absent |
| `AARIA_HEARTBEAT_EVERY` | `5m` | Default heartbeat interval (`30s`, `5m`, `1h`, …) |
| `AARIA_MORNING_BRIEF` | on | First WebSocket connect each day triggers a morning brief |
| `AARIA_TIMEZONE` | — | Override `USER.md` timezone for daily brief (default `Asia/Kolkata`) |
| `AARIA_VOICE` | on if backend found | Set `0` to disable local TTS done lines |
| `AARIA_TTS` | `auto` | `auto` \| `piper` \| `spd-say` |
| `AARIA_PIPER_MODEL` | auto-discover | Path to Piper `.onnx` voice |
| `AARIA_VOICE_MAX_CHARS` | `280` | Max chars for spoken snippets |

### Voice reply (local TTS)

The API speaks a **short done** line when an interactive chat turn finishes (TUI, plasmoid, HTTP/WS) — not your message, and not the full technical reply. Scheduler jobs and morning briefs stay silent. No extra Cursor tokens — text is clipped with heuristics.

**Character voice:** British English Piper **Cori** (`en_GB-cori-medium`) by default — calm, composed, FRIDAY-like. Pace defaults to `AARIA_PIPER_LENGTH_SCALE=1.06`.

**Latency:** the TUI calls `POST /voice/warmup` on boot to pre-load Piper before the first reply. The API also warms Piper in the background at process start.

Backends (auto-detected):

1. **Piper** — if `piper` is on `PATH`, a `.onnx` model is found, and `paplay` / `pw-play` / `aplay` / `afplay` (macOS) is available
2. **`spd-say`** — Speech Dispatcher (`en-GB` preferred)
3. Off — chat still works

Install Piper + Cori (recommended — also offered by `install-upgrade.sh` prerequisites):

```bash
bash deploy/install-voice.sh
# or: npm run install-voice
```

Manual Cori download (if you already have `piper` on PATH):

```bash
mkdir -p ~/.local/share/piper && cd ~/.local/share/piper
curl -fsSL -o en_GB-cori-medium.onnx \
  "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_GB/cori/medium/en_GB-cori-medium.onnx?download=true"
curl -fsSL -o en_GB-cori-medium.onnx.json \
  "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_GB/cori/medium/en_GB-cori-medium.onnx.json?download=true"
```

Startup logs which engine is active: `[aria-voice] engine=…`.

### Morning brief (first connect)

On the **first WebSocket connection each calendar day** (user timezone from `USER.md`, or `AARIA_TIMEZONE`), AARIA runs a short agent turn and pushes a **morning brief** over the socket (`brief` / `brief_chunk` messages). The TUI shows it right after the greeting.

- Delivery state is stored under the session dir (`morning-brief-date.txt`) — reconnecting the same day does not repeat it.
- Uses host snapshot (RAM, load) from the heartbeat collector; no learn review on brief turns.
- Disable with `AARIA_MORNING_BRIEF=0`.

This is separate from the optional **scheduled** `morning-brief` prompt job in `jobs.json` (cron at a fixed time).

### Scheduler (heartbeat + cron jobs)

ARIA runs a lightweight in-process scheduler when `AARIA_SCHEDULER` is on (default).

**Without `jobs.json`:** a built-in **heartbeat** runs every `AARIA_HEARTBEAT_EVERY` (default `5m`). It logs host RAM/load and records warnings when memory or load is high.

**With `jobs.json`:** copy `jobs.sample.json` → `jobs.json` and edit. Two job types:

| Type | Purpose |
|------|---------|
| `heartbeat` | Self-check (RAM, load, warm status) — logs to journal |
| `prompt` | Runs an agent turn on a schedule (e.g. morning brief) |

Schedule each job with **either** `every` (e.g. `"5m"`, `"30s"`, `"1h"`) **or** `cron` (standard 5-field expression, optional `timezone`).

```json
{
  "jobs": [
    {
      "id": "heartbeat",
      "type": "heartbeat",
      "enabled": true,
      "schedule": { "every": "5m" }
    },
    {
      "id": "morning-brief",
      "type": "prompt",
      "enabled": true,
      "schedule": { "cron": "0 9 * * *", "timezone": "Asia/Kolkata" },
      "message": "Brief morning work-desk status — 3–5 bullets.",
      "skipIfBusy": true,
      "learn": false
    }
  ]
}
```

- **`skipIfBusy`** (prompt jobs, default `true`) — skips the run if chat/learn work is queued (RAM-friendly on constrained hosts).
- **`learn`** (prompt jobs, default `false`) — when `false`, scheduled turns do not trigger the post-turn learn review.

**API:** `GET /jobs`, `POST /jobs/run`, `POST /jobs/reload`, `GET /heartbeat`. Last heartbeat is also included in `GET /health`.

**Optional external watchdog:** `bash deploy/install-heartbeat-timer.sh` (Linux) or `npm run install-heartbeat:win` (Windows) installs an external trigger that `POST`s `/jobs/run` with `id=heartbeat` every 5 minutes — useful if you want a check outside the Node process. The in-process scheduler is usually enough.

### Learn loop (Phase 1–2)

Inspired by [Hermes Agent](https://github.com/nousresearch/hermes-agent) memory curation:

1. **After each chat turn**, a background LLM review decides if anything durable should be saved.
2. **Work facts** go to `MEMORY.md` (§-prefixed lines, injected at session bootstrap).
3. **User preferences** append to `USER.md` under `## Learned (auto)`.
4. The TUI shows `💾 learned` (or `💾 staged` when approval mode is on).

TUI commands: `/memory pending`, `/memory approve [id|all]`, `/memory reject [id|all]`.

Enable MCP **memory** (`cp .cursor/mcp.json.sample .cursor/mcp.json`) for in-session knowledge-graph recall alongside file memory.

### MCP tools

`.cursor/mcp.json.sample` wires three servers:

- **`memory`** — persistent knowledge graph (`@modelcontextprotocol/server-memory`), runs via `node`.
- **`home-assistant-rest`** — HA REST bridge (`scripts/ha-rest-mcp.mjs`); needs `HA_*` env.
- **`mcp-server-fetch`** — web fetch, runs via `uvx` (needs `uv`; bundled in the Docker image).

Copy the sample to `.cursor/mcp.json` to enable, or set `AARIA_MCP_ENABLED=0` to skip.

---

## Using the TUI

```
$ aaria
 AARIA  work desk · http://127.0.0.1:8788

Sree › help me tail the prod logs for the api pod

Aaria › ⠹ working… (Ctrl+C to cancel)
Aaria › Sure — here's the command…
```

- The prompt greets you by name — AARIA reads `**Call me:** <name>` from `USER.md`
  (falls back to `you` if unset).
- While AARIA is thinking, a `Aaria › ⠹ working…` indicator animates until the first
  token arrives. Your keystrokes are held back during the reply so the two never
  interleave; press **Ctrl+C** to cancel the current turn.

Built-in commands (type `/` for live suggestions, `Tab` to complete):

| Command | Description |
|---------|-------------|
| `/help` | Show help |
| `/health` | Backend status |
| `/ops` | Ops overlay (Health / Jobs / Memory / Chat / Cursor / Fleet) — also **Ctrl+O**; set `AARIA_OPS=0` to disable |
| `/memory` | Learn loop (`pending` · `approve` · `reject` · `curate`) |
| `/skills` | List installed skills |
| `/skill <name> [prompt]` | Load a skill for this turn |
| `/voice` | Voice on/off (`/voice` · `on` · `off`) |
| `/new` (`/reset`) | Fresh Cursor session (clears ops chat history) |
| `/cancel` | Cancel the current reply |
| `/quit` (`/exit`, `Ctrl+D`) | Exit |

Anything else is sent to AARIA as a work request. If the API isn't running, the TUI
auto-starts `aria-api.service` and waits for it to warm up (host installs only).
If the WebSocket drops, the TUI reconnects automatically.

---

## Project layout

```
MXPF-AARIA-API/
├── bin/aaria                 # TUI launcher (bash; Linux/macOS)
├── bin/aaria.cmd             # TUI launcher (Windows)
├── deploy/
│   ├── README.md               # Linux / macOS / Windows deploy matrix
│   ├── aria-api.service.in     # systemd user-unit template (Linux)
│   ├── com.aaria.api.plist.in  # LaunchAgent template (macOS)
│   ├── aaria-api-launch.sh     # LaunchAgent entrypoint (loads .env)
│   ├── aria-api.launch.cmd.in  # API launch template (Windows)
│   ├── aria-heartbeat.*.in     # optional external heartbeat (Linux)
│   ├── aria-heartbeat.invoke.cmd.in
│   ├── _windows.ps1            # shared PowerShell helpers
│   ├── invoke-heartbeat.ps1    # heartbeat POST (Windows)
│   ├── install-service.sh / install-service.ps1
│   ├── install-heartbeat-timer.sh / install-heartbeat-timer.ps1
│   ├── install-upgrade.sh / install-upgrade.ps1
│   └── install-cli.sh / install-cli.ps1
├── scripts/ha-rest-mcp.mjs   # Home Assistant REST MCP server
├── src/
│   ├── main.ts               # entrypoint (boot → warmup → serve)
│   ├── ws.ts                 # HTTP + WebSocket server
│   ├── agent-*.ts, chat.ts, stream.ts, runs.ts, session.ts
│   ├── persona.ts, warmup.ts, config/mcp.ts, debug.ts, errors.ts
│   ├── scheduler/            # heartbeat + cron/interval jobs
│   └── tui/                  # terminal client (main, client, commands, spinner, theme, bootstrap, config)
├── jobs.sample.json          # scheduler job definitions (copy → jobs.json)
├── SOUL.sample.md / USER.sample.md
├── .env-sample
├── .cursor/mcp.json.sample
├── Dockerfile / docker-compose.yaml / .dockerignore
└── README.md
```

---

## Troubleshooting

- **`CURSOR_API_KEY` missing / auth errors** — set it in `.env`; for Docker it's read via
  `env_file: .env`.
- **Port 8788 already in use** — a host service and the container are both running. Stop
  one: `systemctl --user stop aria-api.service` or `docker compose down`.
- **TUI can't reach the API** — check `curl http://127.0.0.1:8788/health`; confirm the
  service/container is up and `AARIA_API_URL` matches.
- **MCP `mcp-server-fetch` fails on host** — install `uv` (`pipx install uv` or the
  official installer). It's preinstalled in the Docker image.
- **Docker healthcheck stuck `starting`** — first boot warms the agent; allow ~40s
  (`start_period`). Inspect with `docker compose logs -f aaria-api`.
- **Fresh session wanted** — remove the state volume: `docker compose down -v`.

---

## Related projects

- **Amelia** (`amelia-widget`) — the home/personal assistant + KDE plasmoid (port 8787).
- **ASTRA** (`MXPF-ASTRA-AGENT`) — remote site minions over MQTT (HiveMQ default). Design:
  `MXPF-ASTRA-AGENT/docs/superpowers/specs/2026-07-18-astra-design.md`.
- **SSH-Connect** — interactive remote console MCP (complement to ASTRA).
- **MXPF-AARIA-THEME** — design tokens for the AARIA visual identity.

AARIA and Amelia are siblings: same SDK foundation, different lanes. ASTRA minions extend
AARIA’s reach to remote assets. Keep work with AARIA, home with Amelia, sites with ASTRA.
