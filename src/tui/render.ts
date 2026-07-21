import { c } from "./theme.js";

/**
 * Light inline colouring for streamed assistant text.
 * Only complete patterns are styled — safe for chunked output.
 */
export function colorizeReplyChunk(text: string): string {
  if (!text || text.length === 0) {
    return text;
  }

  let out = text;

  out = out.replace(/\*\*([^*\n]+)\*\*/g, `${c.bold}${c.accent}$1${c.reset}`);
  out = out.replace(/`([^`\n]+)`/g, `${c.brand}$1${c.reset}`);
  out = out.replace(/^### (.+)$/gm, `${c.bold}${c.plum}$1${c.reset}`);
  out = out.replace(/^## (.+)$/gm, `${c.bold}${c.agent}$1${c.reset}`);
  out = out.replace(/^- /gm, `${c.gold}•${c.reset} `);

  return out;
}

export function colorizeCommandLine(name: string, summary: string): string {
  // Wide enough for labels like `/health[/hl]` / `/skills[/ss]`.
  return `  ${c.cmd}${c.bold}${name.padEnd(14)}${c.reset}${c.dim}${summary}${c.reset}`;
}
