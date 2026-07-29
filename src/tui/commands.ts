export type SlashCommand = {
  name: string;
  aliases?: string[];
  summary: string;
};

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "/help", aliases: ["/h"], summary: "Show this help" },
  { name: "/health", aliases: ["/hl"], summary: "Backend status" },
  {
    name: "/ops",
    aliases: ["/o"],
    summary: "Ops overlay (panels · metrics) — also Ctrl+O",
  },
  {
    name: "/memory",
    aliases: ["/m"],
    summary: "Memory learn loop (pending · approve · reject · curate)",
  },
  { name: "/skills", aliases: ["/ss"], summary: "List installed skills" },
  {
    name: "/skill",
    aliases: ["/sk"],
    summary: "Load a skill for the next turn (/skill <name> [prompt])",
  },
  { name: "/cancel", aliases: ["/c"], summary: "Cancel the current reply" },
  {
    name: "/voice",
    aliases: ["/v"],
    summary: "Voice on/off (/voice · /voice on · /voice off)",
  },
  {
    name: "/new",
    aliases: ["/n", "/reset"],
    summary: "Start a fresh Cursor session (unstick a frozen agent)",
  },
  {
    name: "/quit",
    aliases: ["/q", "/exit"],
    summary: "Exit (also /q, /exit, Ctrl+D)",
  },
];

/** Short display alias: 1–2 letters after `/` (e.g. /h, /hl). */
export function shortcutOf(cmd: SlashCommand): string | undefined {
  return (cmd.aliases ?? []).find((alias) => /^\/[a-z]{1,2}$/i.test(alias));
}

/** Help label: `/help[/h]` when a short alias exists. */
export function commandLabel(cmd: SlashCommand): string {
  const shortcut = shortcutOf(cmd);
  return shortcut ? `${cmd.name}[${shortcut}]` : cmd.name;
}

/** Resolve exact name or alias to the canonical command. */
export function resolveCommand(token: string): SlashCommand | undefined {
  const t = token.toLowerCase();
  return SLASH_COMMANDS.find(
    (cmd) =>
      cmd.name === t || (cmd.aliases ?? []).some((alias) => alias === t),
  );
}

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
  const prefixMatches = SLASH_COMMANDS.filter(
    (cmd) =>
      cmd.name.startsWith(t) ||
      (cmd.aliases ?? []).some((alias) => alias.startsWith(t)),
  );
  // `/skill` is a prefix of `/skills` — when the token is an exact command name,
  // show only that command (not the longer sibling).
  const exact = prefixMatches.filter(
    (cmd) =>
      cmd.name === t || (cmd.aliases ?? []).some((alias) => alias === t),
  );
  if (exact.length > 0) {
    return exact;
  }
  return prefixMatches;
}

/** readline completer: completes slash commands, passes everything else through. */
export function completeLine(line: string): [string[], string] {
  if (!line.startsWith("/")) {
    return [[], line];
  }
  const lower = line.toLowerCase();
  const names = allCommandNames();
  const exact = names.filter((name) => name === lower);
  if (exact.length > 0) {
    return [exact, line];
  }
  const hits = names.filter((name) => name.startsWith(lower));
  return [hits.length > 0 ? hits : names, line];
}

/** True when the text looks like a bare slash-command token (no path, no spaces). */
export function looksLikeCommand(text: string): boolean {
  return /^\/[a-zA-Z]+$/.test(text);
}

function firstToken(text: string): string {
  return text.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}

/** Prefix commands with sub-arguments (e.g. /memory pending, /m pending). */
export function isMemoryCommand(text: string): boolean {
  const head = firstToken(text);
  return head === "/memory" || head === "/m";
}

export function isSkillsCommand(text: string): boolean {
  const lower = text.trim().toLowerCase();
  return lower === "/skills" || lower === "/ss";
}

/** Bare `/skill` or `/sk` with no name — show usage (not sent to the agent). */
export function isBareSkillCommand(text: string): boolean {
  const lower = text.trim().toLowerCase();
  return lower === "/skill" || lower === "/sk";
}

export function isSkillCommand(text: string): boolean {
  return /^\/(?:skill|sk)\s+\S+/i.test(text.trim());
}

export function isVoiceCommand(text: string): boolean {
  return /^\/(?:voice|v)(?:\s+\S+)?$/i.test(text.trim());
}

const EXACT_COMMANDS = new Set(allCommandNames());

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
  if (isBareSkillCommand(trimmed)) {
    return true;
  }
  if (isSkillCommand(trimmed)) {
    return true;
  }
  if (isVoiceCommand(trimmed)) {
    return true;
  }
  return looksLikeCommand(trimmed);
}

/** Parse `/skill|/sk <name> [prompt]` — returns null if not a skill load command. */
export function parseSkillCommand(
  text: string,
): { name: string; prompt: string } | null {
  const match = text
    .trim()
    .match(/^\/(?:skill|sk)\s+(\S+)(?:\s+([\s\S]*))?$/i);
  if (!match) {
    return null;
  }
  return { name: match[1]!, prompt: match[2]?.trim() ?? "" };
}
