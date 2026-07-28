# Switchable agent runtime (Cursor ↔ Claude Agent SDK)

**Date:** 2026-07-28  
**Status:** Implemented (MVP) — **AARIA only**  
**Related:** `2026-07-20-pluggable-ai-brain-future.md`

## Scope

- **In scope:** `MXPF-AARIA-API` only.
- **Out of scope for now:** Amelia (`amelia-widget`), ASTRA minions (`MXPF-ASTRA-AGENT` / `ASTRA_BRAIN`). Those stay Cursor-only until a later pass.

## Goal

Let AARIA select its agent harness at boot via env:

- `AARIA_RUNTIME=cursor` (default) — existing `@cursor/sdk`
- `AARIA_RUNTIME=claude` — `@anthropic-ai/claude-agent-sdk`

Chat, TUI, scheduler, learn loop, and fleet keep working unchanged above a thin `AriaAgent` / `AriaRun` interface.

## Architecture

```text
agent-manager / chat / stream / persona / learn
              │
              ▼
        AriaAgent (interface)
         ├── CursorRuntime  → Agent.create / resume / send
         └── ClaudeRuntime  → query() + session resume
```

## Config

| Env | Purpose |
|-----|---------|
| `AARIA_RUNTIME` | `cursor` \| `claude` (aliases: `anthropic`) |
| `CURSOR_API_KEY` | Required when runtime=`cursor` |
| `ANTHROPIC_API_KEY` | Required when runtime=`claude` |
| `AARIA_MODEL` | Provider model id; for Claude, Cursor-only ids (`default`, `composer-*`) map to `AARIA_CLAUDE_MODEL` or `claude-sonnet-4-5` |
| `AARIA_CLAUDE_MODEL` | Optional Claude default when `AARIA_MODEL` is Cursor-ish |

Session IDs are persisted separately per runtime (`agent-id.cursor.txt` / `agent-id.claude.txt`) so switching runtimes does not corrupt resume. Learn review uses a separate Claude session file (`agent-id.claude.learn.txt`).

## Non-goals (MVP)

- Amelia / ASTRA adapters
- OpenRouter / OpenAI / xAI adapters
- Cross-runtime conversation migration
- Claude Managed Agents REST
- Renaming `/cursor` HTTP route (status payload gains `runtime` field)

## Constraints

- Default remains Cursor; no behavior change when `AARIA_RUNTIME` unset
- Claude headless mode must not block on permission prompts (`bypassPermissions`)
- MCP from `.cursor/mcp.json` reused when enabled (main agent only; learn agent has no MCP)
