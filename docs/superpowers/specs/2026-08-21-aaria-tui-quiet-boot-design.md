# AARIA TUI quiet first paint

**Date:** 2026-08-21  
**Status:** Approved (Approach A)  
**Branch:** `feat/tui-quiet-boot`

## Goal

Make the initial TUI screen chat-first and less noisy, while keeping full help on demand. Disable voice by default on this host so boot is not blocked by Piper warmup.

## Boot layout (in order)

1. Compact banner: wordmark + `work desk · <apiBase>` + `v… · session …`
2. One status strip: `voice on|off · runtime=… ·` optional heat when present
3. One hint line: `type / for commands · /help for full list`
4. Greeting → morning brief (if due) → prompt

Do **not** print the formal name expansion or the full slash-command dump on boot.

## `/help`

Unchanged depth: formal title, full command list, usage hints.

## Morning brief

- Header stays gold “Morning brief”
- Buffer streamed chunks; render the complete brief once with `colorizeReplyChunk` so `**Host:**` etc. style correctly (chunked mid-`**` was leaving raw markdown)

## Voice

- Code already defaults voice off unless `AARIA_VOICE=1` or `/voice on`
- Local `.env`: set `AARIA_VOICE=0` (gitignored)
- When voice is off, skip boot “priming voice” / warmup call entirely

## Out of scope

Ink/React redesign, palette rewrite, ops overlay chrome, morning-brief content changes
