# Persistent Piper TTS (embedded in aria-api)

**Date:** 2026-07-19  
**Status:** Approved · Implemented (2026-07-19)  
**Approach:** A — long-lived Piper child inside `aria-api`

## Problem

Every `speak()` / `enqueueSpeech()` currently spawns a fresh `piper` process, which reloads the ONNX voice (~10–14s on this host). Text streams live; speech lags far behind.

Benchmarks on this machine (`en_GB-cori-medium`):

| Mode | Time to first ~1s PCM |
|------|------------------------|
| One-shot spawn | ~12s |
| Persistent process, 2nd utterance | ~0.7s |

## Goal

Preload the Piper model once during voice warmup and reuse the same process for all subsequent utterances, streaming raw PCM to the player in realtime.

## Design

### Lifecycle

1. On `warmVoice()` / first speak (if not yet warm): spawn  
   `piper -m <model> --output-raw` (+ length-scale / noise / sentence-silence flags).
2. Force model load with a short warmup line written to stdin; discard PCM (or play nothing).
3. Keep the child alive for the life of the `aria-api` process.
4. On each utterance: write one newline-terminated text line to Piper stdin; pipe stdout PCM into paplay/pw-play/aplay.
5. On cancel / interrupt (`speak()` replace, `stopSpeech()`): kill the **player** only when possible; leave Piper running. Clear the speech queue.
6. If Piper exits unexpectedly: clear handle, log, respawn lazily on next speak/warm.
7. On API shutdown or voice mute: kill Piper + player, clear queue.
8. If persistent start fails: fall back to legacy one-shot spawn so voice never hard-breaks.

### Queue integration

Existing `enqueueSpeech` / `speak` / `utteranceGen` stay. Persistent mode only changes how a single utterance is synthesized (reuse child vs spawn).

### Framing / EOF

- Piper reads **line-oriented** text from stdin (verified: multiple lines reuse the loaded model).
- Do **not** close Piper stdin between utterances.
- Text must be a single line (newlines collapsed) before write.

### Config

| Env | Default | Meaning |
|-----|---------|---------|
| `AARIA_PIPER_PERSISTENT` | `1` (on) | `0`/`false`/`off` → legacy one-shot |
| Existing `AARIA_PIPER_*` | unchanged | model, length-scale, etc. |

### Out of scope

- Separate `aria-piper.service`
- Mid-process voice hot-swap
- CUDA / GPU Piper
- Third-party HTTP Piper wrappers

## Touch points

- `src/tts.ts` — persistent worker, warm, speak paths, fallback
- `.env-sample` — document `AARIA_PIPER_PERSISTENT`
- Optional: log line `engine=piper … mode=persistent` on probe/warm

## Success criteria

- After warmup, second utterance TTFA ≪ cold start (order of ~1s, not ~12s).
- Cancel still stops audible playback promptly.
- `AARIA_PIPER_PERSISTENT=0` restores previous behavior.
- Voice still works if persistent spawn fails (fallback).
