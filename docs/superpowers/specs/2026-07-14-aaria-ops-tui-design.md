# AARIA Ops TUI — Design

**Date:** 2026-07-14  
**Status:** Approved for v1 implementation

## Goal

Add an optional lazydocker-style ops overlay to `aaria` without replacing the light readline chat TUI.

## Decisions

| Topic | Choice |
|-------|--------|
| Primary UX | Hybrid: light chat default, ops on demand |
| Left rail | Health · Jobs · Memory · Chat history |
| Metrics | Live snapshot + client-side sparklines |
| Stack | Keep readline; Ink overlay for ops only |
| Actions (v1) | View + run job, approve/reject pending learn |
| Disable | `AARIA_OPS=0` hides toggle and `/ops` |

## Architecture

```
readline chat ──Ctrl+O | /ops──► Ink OpsApp ──q | Ctrl+O──► readline resumes
                     │
              HTTP GET/POST :8788
```

Light mode is unchanged. Ops is a suspend–resume overlay in the same process.

## Layout

```
┌─────────────┬──────────────────────────────┐
│ [1] Health  │ Tabs depend on left focus    │
│ [2] Jobs    │                              │
│ [3] Memory  │                              │
│ [4] Chat    │                              │
├─────────────┴──────────────────────────────┤
│ key hints                                  │
└────────────────────────────────────────────┘
```

### Main tabs by panel

- **Health:** Snapshot · History (sparklines from local ring buffer)
- **Jobs:** Overview · Detail
- **Memory:** Pending · Help
- **Chat:** Preview (session-local buffer only)

## Mode switch

1. Pause readline, clear hint, clear screen
2. `ink.render(<OpsApp />)` until exit
3. Unmount Ink, restore cursor, resume readline, prompt

Blocked while a chat turn is streaming.

## Non-goals (v1)

Mouse, fullscreen modes, Docker/k8s panels, full slash-command parity, server-side metrics history, Ink rewrite of chat.

## Success

- Default `aaria` feels identical to today
- `/ops` or `Ctrl+O` opens panels; `q` returns to chat
- Health shows gauges + sparklines; Jobs run / Memory approve|reject work
