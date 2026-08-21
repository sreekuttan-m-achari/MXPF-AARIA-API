# AARIA TUI quiet boot — Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use checkbox syntax.

**Goal:** Quiet first-paint TUI + voice-off snappy boot.

**Architecture:** Replace startup `printHelp()` with `printBootUi(health)`; keep `printHelp` for `/help`. Buffer morning brief for one styled render. Skip voice warmup when disabled.

**Tech Stack:** Node readline TUI, existing `theme.ts` / `render.ts`

## Global Constraints

- Do not dump full slash commands on boot
- `/help` remains complete
- Voice stays opt-in; local `.env` AARIA_VOICE=0

---

### Task 1: Boot UI helpers

**Files:** `src/tui/main.ts`, optionally `src/tui/theme.ts`

- [ ] Add `formatBootStatusStrip(health)` and `printBootUi(health)`
- [ ] Call `printBootUi` instead of `printHelp` at end of `main`
- [ ] Skip voice warm / “priming voice” when `health.voice?.enabled === false`

### Task 2: Morning brief styling

**Files:** `src/tui/main.ts`

- [ ] Buffer `onChunk` text; on `onBrief` print header + `colorizeReplyChunk(full)`

### Task 3: Local voice off + verify

- [ ] Set `.env` `AARIA_VOICE=0`
- [ ] Run `npm test`
- [ ] Commit design + code (not `.env`)
