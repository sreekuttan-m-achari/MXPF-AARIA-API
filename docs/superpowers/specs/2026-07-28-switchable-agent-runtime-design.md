# Switchable agent runtime (Cursor ↔ Claude Agent SDK)

**Date:** 2026-07-28  
**Updated:** 2026-08-20  
**Status:** Implemented (MVP) — **AARIA only**; model-pipe failover **planned**  
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
                    │
                    ├── Anthropic API (today)
                    ├── OpenRouter Anthropic skin (planned pipe)
                    └── LiteLLM / Ollama Anthropic-compat (planned pipe)
```

**Harness vs pipe:** OpenRouter and Ollama are model endpoints, not new harnesses. Failover when Cursor/Anthropic tokens run out should keep `AARIA_RUNTIME=claude` and redirect the SDK base URL — never a chat-completions-only client (that drops tools/MCP).

## Config

| Env | Purpose |
|-----|---------|
| `AARIA_RUNTIME` | `cursor` \| `claude` (aliases: `anthropic`) |
| `CURSOR_API_KEY` | Required when runtime=`cursor` |
| `ANTHROPIC_API_KEY` | Required when runtime=`claude` (direct Anthropic) |
| `AARIA_MODEL` | Provider model id; for Claude, Cursor-only ids (`default`, `composer-*`) map to `AARIA_CLAUDE_MODEL` or `claude-sonnet-4-5` |
| `AARIA_CLAUDE_MODEL` | Optional Claude default when `AARIA_MODEL` is Cursor-ish |
| `AARIA_LLM_BASE_URL` | **Planned** — Claude Agent SDK pipe (`https://openrouter.ai/api`, LiteLLM, etc.) |
| `AARIA_LLM_API_KEY` | **Planned** — auth for that pipe |

Session IDs are persisted separately per runtime (`agent-id.cursor.txt` / `agent-id.claude.txt`) so switching runtimes does not corrupt resume. Learn review uses a separate Claude session file (`agent-id.claude.learn.txt`).

## Planned: pipe failover (token outrun / backup)

1. Operator (or future auto-failover) sets `AARIA_RUNTIME=claude`.
2. Claude runtime applies pipe env before `query()` / `startup()`:

   - `ANTHROPIC_BASE_URL` ← `AARIA_LLM_BASE_URL`
   - `ANTHROPIC_AUTH_TOKEN` ← `AARIA_LLM_API_KEY`
   - `ANTHROPIC_API_KEY=""` (explicit empty; required for OpenRouter-style bridges)

3. `AARIA_MODEL` uses provider-specific ids (`anthropic/claude-sonnet-4.5` on OpenRouter, local model name via LiteLLM).

Prefer LiteLLM in front of Ollama rather than pointing the Agent SDK at raw Ollama unless the Anthropic-compat surface is verified.

## Non-goals (MVP)

- Amelia / ASTRA adapters
- Chat-only OpenRouter / OpenAI / xAI clients (no tool loop)
- Automatic quota detection / hot failover mid-session (document manual switch first; auto later)
- Cross-runtime conversation migration
- Claude Managed Agents REST
- Renaming `/cursor` HTTP route (status payload gains `runtime` field)

## Constraints

- Default remains Cursor; no behavior change when `AARIA_RUNTIME` unset
- Claude headless mode must not block on permission prompts (`bypassPermissions`)
- MCP from `.cursor/mcp.json` reused when enabled (main agent only; learn agent has no MCP)
- Backup pipes must preserve harness behavior (tools, MCP, cancel, streaming)
