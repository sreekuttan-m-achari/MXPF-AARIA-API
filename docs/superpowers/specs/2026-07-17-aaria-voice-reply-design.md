# AARIA voice reply (local TTS) — Design

**Date:** 2026-07-17  
**Updated:** 2026-07-19 (streaming sentences + persistent Piper)  
**Status:** Implemented  
**Scope:** Speak interactive chat via local TTS; listening deferred

## Goal

Give ARIA a lightweight **voice reply** path: speak during interactive turns (TUI, plasmoid, HTTP/WS), without reading full technical replies or spending extra Cursor tokens. Cursor SDK remains the only LLM brain.

## Architecture

Voice lives in **`MXPF-AARIA-API`** (server-side), not in the TUI. That way TUI, KDE plasmoid, and HTTP clients all get speech when the API host has audio.

```text
handleChatTurn (chat.ts)
  ├─ stream chunks → enqueueSpeech(pullStreamSpeech…)    # assistant sentences only
  ├─ success → enqueue leftover (finalize)               # no full replay
  └─ cancel → stopSpeech()                               # keeps persistent Piper
```

User messages are never spoken. Startup greetings / explicit `/voice/speak` notifications still use TTS.

| File | Role |
|------|------|
| `src/spoken.ts` | Clip / clean / stream sentence tracker |
| `src/tts.ts` | Piper (persistent or one-shot) → spd-say → off |
| `src/chat.ts` | Wires ack + mid-stream queue |

**Silent by default:** transports `job` and `brief` (scheduler / morning brief). Override with `ChatTurnOptions.voice`.

## Persistent Piper (default)

See `2026-07-19-persistent-piper-tts-design.md`.

- Warmup starts a long-lived `piper --output-raw` with the ONNX model loaded once.
- Utterances are written as stdin lines; raw PCM streams to `paplay` / `pw-play` / `aplay`.
- Follow-up TTFA drops from ~12 s (reload) to ~0.5 s on typical hosts.
- `AARIA_PIPER_PERSISTENT=0` restores legacy one-shot spawn.

## Env

`AARIA_VOICE`, `AARIA_TTS`, `AARIA_PIPER_MODEL`, `AARIA_PIPER_PERSISTENT`,
`AARIA_PIPER_PCM_IDLE_MS`, `AARIA_PIPER_QUALITY`, `AARIA_VOICE_MAX_CHARS`,
`AARIA_VOICE_PROVISIONAL_CHARS`, Piper/spd-say tunables — see `.env-sample` and README.

## Non-goals

- STT / listening
- Speaking full unclipped replies / code blocks
- TUI-local TTS (would miss plasmoid/HTTP)
- Extra LLM for spoken summaries
- Separate `aria-piper.service` (optional later; Approach B)
