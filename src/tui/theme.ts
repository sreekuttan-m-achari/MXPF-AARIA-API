const reset = "\x1b[0m";
const dim = "\x1b[2m";
const bold = "\x1b[1m";
const italic = "\x1b[3m";

// FRIDAY palette — cool cyan brand, lavender agent, warm accents
const cyan = "\x1b[38;5;117m";
const lavender = "\x1b[38;5;183m";
const rose = "\x1b[38;5;218m";
const green = "\x1b[38;5;114m";
const yellow = "\x1b[38;5;221m";
const red = "\x1b[38;5;203m";
const gold = "\x1b[38;5;179m";
const teal = "\x1b[38;5;80m";
const sky = "\x1b[38;5;159m";
const mist = "\x1b[38;5;252m";
const plum = "\x1b[38;5;141m";

export const c = {
  reset,
  dim,
  bold,
  italic,
  brand: cyan,
  agent: lavender,
  accent: rose,
  ok: green,
  warn: yellow,
  err: red,
  gold,
  teal,
  sky,
  text: mist,
  plum,
  cmd: sky,
};

export function brandLine(text: string): string {
  return `${c.brand}${c.bold}${text}${c.reset}`;
}

/** Formal designation: AARIA (two A's) as A.A.R.I.A. */
export const FORMAL_NAME = "A.A.R.I.A.";
export const NAME_EXPANSION =
  "Augmented Adaptive Reasoning Intelligence Assistant";

export function formalTitleLine(): string {
  return `${c.plum}${c.bold}${FORMAL_NAME}${c.reset} ${c.dim}— ${c.agent}${NAME_EXPANSION}${c.reset}`;
}

/** Display name AARIA uses for herself in the chat (two A's, capitalised). */
export const AGENT_LABEL = "Aaria";

export function agentPrefix(): string {
  return `${c.agent}${c.bold}${AGENT_LABEL}${c.reset} ${c.plum}›${c.reset} `;
}

export function userPrefix(name?: string): string {
  const label = name?.trim() || "you";
  return `${c.brand}${c.bold}${label}${c.reset} ${c.teal}›${c.reset} `;
}

/** Compact coloured wordmark for banners. */
export function ariaWordmark(): string {
  const letters = ["A", "A", "R", "I", "A"];
  const sep = `${c.dim}·${c.reset}`;
  return letters
    .map((ch, i) => {
      const color = i % 2 === 0 ? c.brand : c.agent;
      return `${color}${c.bold}${ch}${c.reset}`;
    })
    .join(sep);
}

export function learnTargetStyle(target: string): { label: string; color: string } {
  switch (target) {
    case "memory":
      return { label: "MEMORY.md", color: c.teal };
    case "user":
      return { label: "USER.md", color: c.accent };
    case "skill":
      return { label: "skills/", color: c.gold };
    default:
      return { label: target, color: c.dim };
  }
}

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
