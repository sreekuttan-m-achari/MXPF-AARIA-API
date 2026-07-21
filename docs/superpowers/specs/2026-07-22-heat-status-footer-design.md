# Heat-colored context status footer — Design

**Date:** 2026-07-22  
**Status:** Approved for implementation

## Goal

Make the post-reply context footer (`ctx · mem · user`) visually distinct from assistant reply text, and color each metric by pressure on a smooth green→orange→red ramp.

## Decisions

| Topic | Choice |
|-------|--------|
| Typography | Whole footer italic |
| Color model | Smooth 0–100% lerp green → orange → red per metric |
| Separators | Dim / neutral ` · ` |
| Missing ctx | Dim `ctx —` (not heat-colored) |
| Where helpers live | `src/tui/theme.ts` |
| Call sites | Post-reply footer in `main.ts`; `/health` context line |
| Out of scope | Ops overlay gauges; connection-status prompt work; changing `ContextStatus` data |

## Look

After each reply (when context is present):

```text
ctx 100% · mem 77% · user 50%
```

- Line is italic so it reads as metadata, not reply body.
- Each `name pct%` segment uses `heatColor(pct)`.
- Separators stay dim.
- No extra system chat lines.

Example heat points (approximate):

| pct | feel |
|-----|------|
| 0 | green |
| 50 | orange |
| 100 | red |

## Architecture

```
ContextStatus (API / done payload)
        │
        ▼
main.ts ──► formatHeatStatusLine({ ctxPct, memPct, userPct })
                    │
                    ▼
              theme.ts
              · heatColor(pct) → truecolor ANSI
              · formatHeatStatusLine → italic footer string
```

### `heatColor(pct: number): string`

1. Clamp `pct` to `[0, 100]`.
2. Lerp RGB along green → orange → red (two segments: 0–50 and 50–100).
3. Emit truecolor foreground: `\x1b[38;2;r;g;bm`.

### `formatHeatStatusLine(parts)`

Builds:

```
{italic}{heat}ctx N%{reset}{dim} · {reset}{heat}mem N%{reset}{dim} · {reset}{heat}user N%{reset}
```

If `ctxPct` is `null`, emit dim `ctx —` instead of a heat segment.

### Call sites

1. **`onDone` footer** in `src/tui/main.ts` — replace the current `${c.dim}${w} · mem …` write.
2. **`/health` context line** — use the same helper for the `ctx · mem · user` portion (standing chars may remain dim after the heat segments).

`src/context-status.ts` stays plain-text / data-only.

## Non-goals

- Banded thresholds (hard cutoffs at 70/90).
- Bold-only percentages.
- Coloring ops Ink gauges with this helper (optional later).
- Auto-reconnect / prompt connection indicator (separate thread).

## Success

- Footer is obviously not part of the reply (italic).
- High `ctx` reads red; low metrics read green; mid values orange.
- `/health` and post-reply footers share the same coloring.
- No change to context math or WebSocket payloads.
