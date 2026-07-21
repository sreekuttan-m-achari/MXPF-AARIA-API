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

const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** Visible column width (ANSI sequences ignored). */
export function visibleWidth(text: string): number {
  return text.replace(ANSI_RE, "").length;
}

/**
 * Keep a command-hint line to a single terminal row so DEC save/restore
 * clear can erase it fully (wrapped hints leave ghosts on backspace).
 */
export function fitCommandHint(text: string, cols: number): string {
  const width = Math.max(8, cols);
  if (visibleWidth(text) <= width) {
    return text;
  }
  const ellipsis = `${c.dim}…${c.reset}`;
  const budget = Math.max(1, width - 1);
  let out = "";
  let plain = 0;
  // Walk code points; skip re-emitting incomplete ANSI by copying chunks between CSI sequences.
  let i = 0;
  while (i < text.length) {
    if (text[i] === "\x1b" && text[i + 1] === "[") {
      const end = text.indexOf("m", i);
      if (end === -1) break;
      out += text.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    const ch = text[i]!;
    if (plain + 1 > budget) {
      return `${out}${ellipsis}`;
    }
    out += ch;
    plain += 1;
    i += 1;
  }
  return `${out}${ellipsis}`;
}

