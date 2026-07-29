# Slash command shortcuts — Design

**Date:** 2026-07-22  
**Status:** Approved for implementation

## Goal

Give every TUI slash command a short alias and show it in `/help` as `name[shortcut]` (e.g. `/help[/h]`).

## Shortcut map

| Command | Shortcut | Notes |
|---------|----------|-------|
| `/help` | `/h` | |
| `/health` | `/hl` | 2-letter (collides with help) |
| `/ops` | `/o` | |
| `/memory` | `/m` | also `/m pending` etc. |
| `/skills` | `/ss` | 2-letter (collides with skill) |
| `/skill` | `/sk` | also `/sk <name> [prompt]` |
| `/cancel` | `/c` | |
| `/voice` | `/v` | also `/v on` / `/v off` |
| `/new` | `/n` | keep `/reset` |
| `/quit` | `/q` | keep `/exit` |

## Decisions

| Topic | Choice |
|-------|--------|
| Mechanism | Existing `aliases` on `SlashCommand` |
| Help label | `commandLabel` → `/help[/h]`; short = 1–2 letters after `/` |
| Dispatch | Exact alias match → same handler as full name |
| Subcommands | `/m`, `/sk`, `/v` accepted by prefix parsers |
| Out of scope | Ops keybindings; changing Ctrl+O |

## Architecture

- `src/tui/commands.ts` — aliases, `shortcutOf`, `commandLabel`, `resolveCommand`, alias-aware parsers / `EXACT_COMMANDS`
- `src/tui/render.ts` / `main.ts` — help uses `commandLabel`; dispatch resolves aliases
- Tests under `src/__tests__/` for resolve, labels, and `/sk` / `/m` parsing

## Success

- `/h`, `/hl`, `/o`, `/m`, `/ss`, `/sk`, `/c`, `/v`, `/n`, `/q` all work
- `/help` shows bracketed shortcuts
- Tab completion still lists full names and aliases
