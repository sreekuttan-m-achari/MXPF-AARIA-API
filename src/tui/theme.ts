const reset = "\x1b[0m";
const dim = "\x1b[2m";
const bold = "\x1b[1m";
const cyan = "\x1b[38;5;117m";
const lavender = "\x1b[38;5;183m";
const rose = "\x1b[38;5;218m";
const green = "\x1b[38;5;114m";
const yellow = "\x1b[38;5;221m";
const red = "\x1b[38;5;203m";

export const c = {
  reset,
  dim,
  bold,
  brand: cyan,
  agent: lavender,
  accent: rose,
  ok: green,
  warn: yellow,
  err: red,
};

export function brandLine(text: string): string {
  return `${c.brand}${c.bold}${text}${c.reset}`;
}

/** Formal designation: AARIA (two A's) as A.A.R.I.A. */
export const FORMAL_NAME = "A.A.R.I.A.";
export const NAME_EXPANSION =
  "Augmented Adaptive Reasoning Intelligence Assistant";

export function formalTitleLine(): string {
  return `${brandLine(FORMAL_NAME)} ${c.dim}— ${NAME_EXPANSION}${c.reset}`;
}

/** Display name AARIA uses for herself in the chat (two A's, capitalised). */
export const AGENT_LABEL = "Aaria";

export function agentPrefix(): string {
  return `${c.agent}${c.bold}${AGENT_LABEL}${c.reset} ${c.dim}›${c.reset} `;
}

export function userPrefix(name?: string): string {
  const label = name?.trim() || "you";
  return `${c.brand}${c.bold}${label}${c.reset} ${c.dim}›${c.reset} `;
}
