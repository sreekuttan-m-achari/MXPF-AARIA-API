# Heat-colored context status footer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the TUI `ctx · mem · user` footer as italic metadata with per-metric smooth green→orange→red heat colors.

**Architecture:** Add `heatColor` and `formatHeatStatusLine` in `src/tui/theme.ts`. Wire both the post-reply footer and `/health` context line in `src/tui/main.ts` to that helper. Keep `src/context-status.ts` plain-text/data-only.

**Tech Stack:** Node.js ≥ 22.13, TypeScript ESM (`tsx`), `node:test` via `npm test`.

## Global Constraints

- Node.js ≥ 22.13; `"type": "module"`; import with `.js` suffixes
- Whole footer italic; separators dim ` · `; missing ctx → dim `ctx —` (not heat-colored)
- Smooth 0–100% lerp: green (0) → orange (50) → red (100); truecolor `\x1b[38;2;r;g;bm`
- Call sites: post-reply `onDone` footer and `/health` ctx/mem/user portion only
- Out of scope: ops Ink gauges, connection-status prompt work, context math / WS payloads
- Prefer small focused helpers; match existing `c.*` theme style
- Tests: `tsx --test` / `npm test` under `src/__tests__/`

## File map

| Path | Responsibility |
|------|----------------|
| `src/tui/theme.ts` | `heatColor`, `formatHeatStatusLine` |
| `src/__tests__/heat-status.test.ts` | Unit tests for heat helpers |
| `src/tui/main.ts` | Replace dim footer writes with `formatHeatStatusLine` |

---

### Task 1: Heat helpers in theme

**Files:**
- Modify: `src/tui/theme.ts`
- Create: `src/__tests__/heat-status.test.ts`
- Test: `src/__tests__/heat-status.test.ts`

**Interfaces:**
- Consumes: existing `c` (`reset`, `dim`, `italic`) in `src/tui/theme.ts`
- Produces:
  - `heatColor(pct: number): string` — ANSI truecolor FG sequence only (no reset)
  - `formatHeatStatusLine(parts: { ctxPct: number | null; memPct: number; userPct: number }): string` — full italic footer line (no leading `\n`)

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/heat-status.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { c, formatHeatStatusLine, heatColor } from "../tui/theme.js";

describe("heatColor", () => {
  it("clamps below 0 and above 100", () => {
    assert.equal(heatColor(-10), heatColor(0));
    assert.equal(heatColor(150), heatColor(100));
  });

  it("returns green at 0, orange at 50, red at 100", () => {
    // RGB endpoints locked in theme.ts implementation
    assert.equal(heatColor(0), "\x1b[38;2;80;200;120m");
    assert.equal(heatColor(50), "\x1b[38;2;245;166;35m");
    assert.equal(heatColor(100), "\x1b[38;2;230;70;70m");
  });

  it("interpolates midpoints", () => {
    // 25% = halfway green→orange (Math.round on each channel)
    assert.equal(heatColor(25), "\x1b[38;2;163;183;78m");
    // 75% = halfway orange→red
    assert.equal(heatColor(75), "\x1b[38;2;238;118;53m");
  });
});

describe("formatHeatStatusLine", () => {
  it("renders italic heat segments with dim separators", () => {
    const line = formatHeatStatusLine({
      ctxPct: 100,
      memPct: 77,
      userPct: 50,
    });
    assert.match(line, new RegExp(`^${escapeRegExp(c.italic)}`));
    assert.match(line, /ctx 100%/);
    assert.match(line, /mem 77%/);
    assert.match(line, /user 50%/);
    assert.ok(line.includes(`${c.dim} · ${c.reset}`));
    assert.ok(line.includes(heatColor(100)));
    assert.ok(line.includes(heatColor(77)));
    assert.ok(line.includes(heatColor(50)));
  });

  it("uses dim ctx — when ctxPct is null", () => {
    const line = formatHeatStatusLine({
      ctxPct: null,
      memPct: 10,
      userPct: 20,
    });
    assert.ok(line.includes(`${c.dim}ctx —${c.reset}`));
    assert.equal(line.includes("ctx 0%"), false);
    assert.ok(line.includes(heatColor(10)));
    assert.ok(line.includes(heatColor(20)));
  });
});

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/sreekuttan/WORKS/AARIA/MXPF-AARIA-API && npx tsx --test src/__tests__/heat-status.test.ts`

Expected: FAIL (exports `heatColor` / `formatHeatStatusLine` missing)

- [ ] **Step 3: Write minimal implementation**

Append to `src/tui/theme.ts` (after existing exports; keep `c` as-is):

```ts
const HEAT_GREEN = { r: 80, g: 200, b: 120 };
const HEAT_ORANGE = { r: 245, g: 166, b: 35 };
const HEAT_RED = { r: 230, g: 70, b: 70 };

function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.min(100, Math.max(0, pct));
}

function lerpChannel(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function lerpRgb(
  from: { r: number; g: number; b: number },
  to: { r: number; g: number; b: number },
  t: number,
): { r: number; g: number; b: number } {
  return {
    r: lerpChannel(from.r, to.r, t),
    g: lerpChannel(from.g, to.g, t),
    b: lerpChannel(from.b, to.b, t),
  };
}

/** Truecolor FG for pressure 0 (green) → 50 (orange) → 100 (red). */
export function heatColor(pct: number): string {
  const p = clampPct(pct);
  const rgb =
    p <= 50
      ? lerpRgb(HEAT_GREEN, HEAT_ORANGE, p / 50)
      : lerpRgb(HEAT_ORANGE, HEAT_RED, (p - 50) / 50);
  return `\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m`;
}

function heatSegment(label: string, pct: number): string {
  return `${c.italic}${heatColor(pct)}${label} ${Math.round(pct)}%${c.reset}`;
}

/**
 * Italic post-reply / health footer: ctx · mem · user with per-metric heat.
 * Leading newline is the caller's responsibility.
 */
export function formatHeatStatusLine(parts: {
  ctxPct: number | null;
  memPct: number;
  userPct: number;
}): string {
  const sep = `${c.italic}${c.dim} · ${c.reset}`;
  const ctx =
    parts.ctxPct == null
      ? `${c.italic}${c.dim}ctx —${c.reset}`
      : heatSegment("ctx", parts.ctxPct);
  const mem = heatSegment("mem", parts.memPct);
  const user = heatSegment("user", parts.userPct);
  return `${ctx}${sep}${mem}${sep}${user}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/sreekuttan/WORKS/AARIA/MXPF-AARIA-API && npx tsx --test src/__tests__/heat-status.test.ts`

Expected: PASS (all tests)

If midpoint RGB assertions fail by ±1 due to rounding, update the expected strings to the implementation’s exact `Math.round` outputs — do not change the endpoints (0/50/100).

- [ ] **Step 5: Commit**

```bash
cd /home/sreekuttan/WORKS/AARIA/MXPF-AARIA-API
git add src/tui/theme.ts src/__tests__/heat-status.test.ts
git commit -m "$(cat <<'EOF'
Add heat-colored italic context status helpers for the TUI footer.

EOF
)"
```

---

### Task 2: Wire footer + /health

**Files:**
- Modify: `src/tui/main.ts` (import + `/health` ctx line + `onDone` footer)
- Test: manual TUI check (automated coverage is Task 1)

**Interfaces:**
- Consumes: `formatHeatStatusLine` from `./theme.js` (Task 1)
- Produces: heat-styled footers in chat and `/health` output

- [ ] **Step 1: Update import in `src/tui/main.ts`**

Change the theme import from:

```ts
import { agentPrefix, ariaWordmark, c, formalTitleLine, learnTargetStyle, userPrefix } from "./theme.js";
```

to:

```ts
import {
  agentPrefix,
  ariaWordmark,
  c,
  formalTitleLine,
  formatHeatStatusLine,
  learnTargetStyle,
  userPrefix,
} from "./theme.js";
```

- [ ] **Step 2: Replace `/health` context line**

In the `/health` handler (~where `ctxLine` is built), replace the dim string assembly with:

```ts
const ctxPct =
  ctx.window.percent != null && ctx.window.usedTokens != null
    ? ctx.window.percent
    : null;
const memPct = Math.round(
  (ctx.prompts.memoryChars / Math.max(1, ctx.prompts.memoryLimit)) * 100,
);
const userPct = Math.round(
  (ctx.prompts.userLearnedChars /
    Math.max(1, ctx.prompts.userLearnedLimit)) *
    100,
);
ctxLine =
  `\n${formatHeatStatusLine({ ctxPct, memPct, userPct })}` +
  `${c.dim} · standing ${ctx.prompts.standingChars}ch${c.reset}`;
```

Remove the old `w` / `${c.dim}${w} · mem …` construction for this line. Token detail in the old `w` string is intentionally dropped here to match the compact heat footer (ops overlay still has full detail).

- [ ] **Step 3: Replace post-reply `onDone` footer**

In `onDone` where context is written, replace:

```ts
const w =
  context.window.percent != null &&
  context.window.usedTokens != null
    ? `ctx ${context.window.percent}%`
    : "ctx —";
const memPct = Math.round(
  (context.prompts.memoryChars /
    Math.max(1, context.prompts.memoryLimit)) *
    100,
);
const userPct = Math.round(
  (context.prompts.userLearnedChars /
    Math.max(1, context.prompts.userLearnedLimit)) *
    100,
);
output.write(
  `\n${c.dim}${w} · mem ${memPct}% · user ${userPct}%${c.reset}`,
);
```

with:

```ts
const ctxPct =
  context.window.percent != null &&
  context.window.usedTokens != null
    ? context.window.percent
    : null;
const memPct = Math.round(
  (context.prompts.memoryChars /
    Math.max(1, context.prompts.memoryLimit)) *
    100,
);
const userPct = Math.round(
  (context.prompts.userLearnedChars /
    Math.max(1, context.prompts.userLearnedLimit)) *
    100,
);
output.write(
  `\n${formatHeatStatusLine({ ctxPct, memPct, userPct })}`,
);
```

- [ ] **Step 4: Run unit tests**

Run: `cd /home/sreekuttan/WORKS/AARIA/MXPF-AARIA-API && npm test`

Expected: PASS (including `heat-status.test.ts`)

- [ ] **Step 5: Manual smoke (optional if API up)**

Run: `cd /home/sreekuttan/WORKS/AARIA/MXPF-AARIA-API && npm run tui`

Then: send any short chat turn and/or type `/health`.

Expected:
- Footer under the reply is italic
- High % segments look redder; low % greener
- Separators stay dim
- `/health` shows the same heat styling for ctx/mem/user (standing remains dim)

- [ ] **Step 6: Commit**

```bash
cd /home/sreekuttan/WORKS/AARIA/MXPF-AARIA-API
git add src/tui/main.ts
git commit -m "$(cat <<'EOF'
Use heat-colored status footer in chat replies and /health.

EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Italic footer | Task 1 `formatHeatStatusLine` |
| Smooth green→orange→red | Task 1 `heatColor` |
| Dim separators | Task 1 |
| Dim `ctx —` when missing | Task 1 |
| Helpers in `theme.ts` | Task 1 |
| Post-reply footer | Task 2 |
| `/health` line | Task 2 |
| No change to `context-status.ts` data | — (untouched) |
| Ops / connection status out of scope | — (untouched) |
