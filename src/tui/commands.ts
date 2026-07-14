export type SlashCommand = {
  name: string;
  aliases?: string[];
  summary: string;
};

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "/help", summary: "Show this help" },
  { name: "/health", summary: "Backend status" },
  { name: "/memory", summary: "Memory learn loop (pending · approve · reject · curate)" },
  { name: "/skills", summary: "List installed skills" },
  { name: "/skill", summary: "Load a skill for the next turn (/skill <name> [prompt])" },
  { name: "/cancel", summary: "Cancel the current reply" },
  { name: "/quit", aliases: ["/exit"], summary: "Exit (also /exit, Ctrl+D)" },
];

/** Every invokable token, including aliases — used for tab completion. */
export function allCommandNames(): string[] {
  return SLASH_COMMANDS.flatMap((cmd) => [cmd.name, ...(cmd.aliases ?? [])]);
}

/** Commands whose name or alias starts with the typed token (case-insensitive). */
export function matchCommands(token: string): SlashCommand[] {
  const t = token.toLowerCase();
  if (t === "/") {
    return SLASH_COMMANDS;
  }
  return SLASH_COMMANDS.filter(
    (cmd) =>
      cmd.name.startsWith(t) ||
      (cmd.aliases ?? []).some((alias) => alias.startsWith(t)),
  );
}

/** readline completer: completes slash commands, passes everything else through. */
export function completeLine(line: string): [string[], string] {
  if (!line.startsWith("/")) {
    return [[], line];
  }
  const names = allCommandNames();
  const hits = names.filter((name) => name.startsWith(line.toLowerCase()));
  return [hits.length > 0 ? hits : names, line];
}

/** True when the text looks like a bare slash-command token (no path, no spaces). */
export function looksLikeCommand(text: string): boolean {
  return /^\/[a-zA-Z]+$/.test(text);
}

/** Prefix commands with sub-arguments (e.g. /memory pending). */
export function isMemoryCommand(text: string): boolean {
  return text.toLowerCase().startsWith("/memory");
}

export function isSkillsCommand(text: string): boolean {
  return text.toLowerCase() === "/skills";
}

export function isSkillCommand(text: string): boolean {
  return /^\/skill\s+\S+/i.test(text.trim());
}

const EXACT_COMMANDS = new Set([
  "/help",
  "/health",
  "/cancel",
  "/quit",
  "/exit",
]);

/** True for built-in slash commands (exact or /memory …). */
export function isBuiltinCommand(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return false;
  }
  const lower = trimmed.toLowerCase();
  if (EXACT_COMMANDS.has(lower)) {
    return true;
  }
  if (isMemoryCommand(trimmed)) {
    return true;
  }
  if (isSkillsCommand(trimmed)) {
    return true;
  }
  return looksLikeCommand(trimmed);
}
