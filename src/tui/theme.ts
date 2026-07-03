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

export function agentPrefix(): string {
  return `${c.agent}${c.bold}aria${c.reset} ${c.dim}›${c.reset} `;
}

export function userPrefix(): string {
  return `${c.brand}${c.bold}you${c.reset} ${c.dim}›${c.reset} `;
}
