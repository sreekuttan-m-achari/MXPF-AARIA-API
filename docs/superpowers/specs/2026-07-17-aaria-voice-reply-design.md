# AARIA voice reply (local TTS) — Design

**Date:** 2026-07-17  
**Status:** Implemented (ported from Amelia)  
**Scope:** Speak short done summaries via local TTS on interactive chat; listening deferred

## Goal

Give ARIA the same lightweight **voice reply** pattern as Amelia: speak a short done summary after interactive turns (TUI, plasmoid, HTTP/WS), without reading full technical replies. Cursor SDK remains the only LLM brain.

## Architecture

Voice lives in **`MXPF-AARIA-API`** (server-side), not in the TUI. That way TUI, KDE plasmoid, and HTTP clients all get speech when the API host has audio.

```text
handleChatTurn (chat.ts)
  ├─ stream chunks → early speak when first sentence ready
  ├─ success → speak(buildDoneSpeech(reply)) if not already spoken
  └─ cancel → stopSpeech()
```

| File | Role |
|------|------|
| `src/spoken.ts` | Heuristic clip / clean for speech |
| `src/tts.ts` | Piper → spd-say → off |

**Silent by default:** transports `job` and `brief` (scheduler / morning brief). Override with `ChatTurnOptions.voice`.

## Env

`AARIA_VOICE`, `AARIA_TTS`, `AARIA_PIPER_MODEL`, `AARIA_VOICE_MAX_CHARS`, Piper/spd-say tunables — see `.env-sample`.

## Non-goals (v1)

- STT / listening
- Speaking full replies
- TUI-local TTS (would miss plasmoid/HTTP)
- Extra LLM for spoken summaries
