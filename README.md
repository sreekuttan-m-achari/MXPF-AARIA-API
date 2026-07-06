# A.A.R.I.A. — Augmented Adaptive Reasoning Intelligence Assistant

> The work-desk intelligence of the workstation. Precise, calm, and mission-focused —
> a feminine presence that is confident without being cold, in the spirit of Tony
> Stark's F.R.I.D.A.Y.

**AARIA** (always two A's — **A**·**A**·RIA, short form *ARIA*) is a local, Cursor-SDK
powered assistant that lives in your terminal and runs as a background service. She owns
the **professional lane**: code, DevOps, servers, infrastructure, and planning. Her
sibling **Amelia** owns the **home lane** (personal life + Home Assistant) and runs as a
separate service. AARIA hands home/personal requests to Amelia and keeps the work desk
for herself.

```
┌──────────────────────────────┐        ┌──────────────────────────────┐
│  ARIA  ·  work lane           │        │  Amelia  ·  home lane         │
│  MXPF-AARIA-API   (port 8788) │        │  amelia-widget    (port 8787) │
│  code · devops · servers      │        │  personal · Home Assistant    │
└──────────────┬───────────────┘        └──────────────┬───────────────┘
               │  Cursor SDK agent                      │  Cursor SDK agent
               ▼                                        ▼
        ┌─────────────────────────────────────────────────────┐
        │  Cursor platform  ·  MCP tools (memory, HA, fetch)    │
        └─────────────────────────────────────────────────────┘
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

Persona is data-driven — edit `SOUL.md` (who she is) and `USER.md` (who you are). Samples
are provided as `SOUL.sample.md` / `USER.sample.md`.

---

## Architecture

| Piece | File(s) | Role |
|-------|---------|------|
| **API server** | `src/main.ts`, `src/ws.ts` | HTTP + WebSocket endpoints, warmup, stale-run cleanup |
| **Agent** | `src/agent-manager.ts`, `src/agent.ts` | Boots the Cursor SDK agent, local store, session resume |
| **Chat** | `src/chat.ts`, `src/stream.ts`, `src/runs.ts` | Turn handling and token streaming |
| **Persona** | `src/persona.ts` | Loads `SOUL.md` / `USER.md` / `MEMORY.md`, working dir |
| **Learn loop** | `src/learn/*.ts` | Post-turn review → `MEMORY.md` / `USER.md` (Hermes-style) |
| **MCP** | `src/config/mcp.ts` | Loads `.cursor/mcp.json` tool servers |
| **TUI** | `src/tui/*.ts` | `aaria` terminal client (REPL, completion, auto-start) |
| **Deploy** | `deploy/*`, `bin/aaria` | systemd unit + CLI installer |

### API endpoints (default `http://127.0.0.1:8788`)

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/health` | Status: name, version, session id, warm flag, greeting, persona/MCP/memory stats |
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

### 1. Configure

```bash
cp .env-sample .env
# edit .env → set CURSOR_API_KEY (required)

cp SOUL.sample.md SOUL.md      # optional: customise the persona
cp USER.sample.md USER.md      # optional: tell her about you
cp MEMORY.sample.md MEMORY.md  # optional: seed agent memory (learn loop appends here)
cp .cursor/mcp.json.sample .cursor/mcp.json   # optional: enable MCP tools (incl. memory)
```

### 2a. Run on the host (systemd user service)

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
| `AARIA_WS_HOST` | `127.0.0.1` (`0.0.0.0` in Docker) | Bind address |
| `AARIA_WS_PORT` | `8788` | HTTP/WS port |
| `AARIA_API_URL` | `http://127.0.0.1:8788` | Base URL the TUI/health client dials |
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
| `/cancel` | Cancel the current reply |
| `/quit` (`/exit`, `Ctrl+D`) | Exit |

Anything else is sent to AARIA as a work request. If the API isn't running, the TUI
auto-starts `aria-api.service` and waits for it to warm up (host installs only).

---

## Project layout

```
MXPF-AARIA-API/
├── bin/aaria                 # TUI launcher (resolves Node/tsx, then runs the client)
├── deploy/
│   ├── aria-api.service.in   # systemd user-unit template
│   ├── install-service.sh    # installs + starts the service
│   └── install-cli.sh        # symlinks `aaria` into ~/.local/bin
├── scripts/ha-rest-mcp.mjs   # Home Assistant REST MCP server
├── src/
│   ├── main.ts               # entrypoint (boot → warmup → serve)
│   ├── ws.ts                 # HTTP + WebSocket server
│   ├── agent-*.ts, chat.ts, stream.ts, runs.ts, session.ts
│   ├── persona.ts, warmup.ts, config/mcp.ts, debug.ts, errors.ts
│   └── tui/                  # terminal client (main, client, commands, spinner, theme, bootstrap, config)
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
- **MXPF-AARIA-THEME** — design tokens for the AARIA visual identity.

AARIA and Amelia are siblings: same SDK foundation, different lanes. Keep work with AARIA,
home with Amelia.
