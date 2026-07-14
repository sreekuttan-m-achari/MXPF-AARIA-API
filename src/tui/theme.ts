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
