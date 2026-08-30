import { completeLocalPath } from "./files/fs.js";

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
    name: "/files",
    aliases: ["/f", "/browse"],
    summary: "File browser — local/remote paths · e edits (also Ctrl+F)",
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
  {
    name: "/console",
    aliases: ["/cn"],
    summary: "Web console pairing (pending · pair · deny · devices · revoke)",
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

/** Agent IDs for `/files @…` Tab completion (from FLEET.md / live fleet). */
let filesAgentIds: string[] = [];

export function setFilesAgentIds(ids: string[]): void {
  filesAgentIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b),
  );
}

export function listFilesAgentIds(): string[] {
  return filesAgentIds;
}

function filterAgentIds(prefix: string): string[] {
  const ids = listFilesAgentIds();
  if (ids.length === 0) {
    return [];
  }
  if (!prefix) {
    return ids;
  }
  const lower = prefix.toLowerCase();
  return ids.filter((id) => id.toLowerCase().startsWith(lower));
}

/**
 * When the line is `/files @partial` (or /f|/browse), return matching agent IDs.
 * Empty prefix → all known IDs. Returns null when not in @-complete context.
 */
export function matchFilesAtAgents(line: string): string[] | null {
  const m = line.match(/^\/(?:files|f|browse)\s+@(\S*)$/i);
  if (!m) {
    return null;
  }
  return filterAgentIds(m[1]!);
}

/**
 * When the line is `/files remote <partial>` (no path yet), return matching agent IDs.
 * Returns null when not in that context.
 */
export function matchFilesRemoteAgents(line: string): string[] | null {
  const m = line.match(/^\/(?:files|f|browse)\s+remote\s+(\S*)$/i);
  if (!m) {
    return null;
  }
  const prefix = m[1]!;
  if (prefix.startsWith("/") || prefix.startsWith("~")) {
    return null;
  }
  return filterAgentIds(prefix);
}

/** Local `/files <path>` token — null when remote/@ or bare command. */
export function matchFilesLocalPath(line: string): string | null {
  const m = line.match(/^\/(?:files|f|browse)\s+(.*)$/i);
  if (!m) {
    return null;
  }
  const rest = m[1]!;
  if (rest.startsWith("@")) {
    return null;
  }
  if (/^remote(?:\s|$)/i.test(rest)) {
    return null;
  }
  return rest;
}

/** Remote path after `@agent` or `remote <agent>` — null when not applicable. */
export function matchFilesRemotePath(
  line: string,
): { agentId: string; pathPrefix: string } | null {
  const at = line.match(/^\/(?:files|f|browse)\s+@(\S+)\s+(.*)$/i);
  if (at) {
    return { agentId: at[1]!, pathPrefix: at[2]! };
  }
  const rem = line.match(/^\/(?:files|f|browse)\s+remote\s+(\S+)\s+(.*)$/i);
  if (rem) {
    const agentId = rem[1]!;
    if (agentId.startsWith("/") || agentId.startsWith("~")) {
      return null;
    }
    return { agentId, pathPrefix: rem[2]! };
  }
  return null;
}

/** Basename-ish labels for compact displays (tests / debug). */
export function pathCompletionHints(completions: string[], limit = 8): string[] {
  return completions.slice(0, limit).map((hit) => {
    const trimmed = hit.replace(/[/\\]+$/, "");
    const sep = hit.includes("\\") && !hit.includes("/") ? "\\" : "/";
    const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
    const base = idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
    return hit.endsWith("/") || hit.endsWith("\\") ? `${base}${sep}` : base;
  });
}

export type InlineSuggestion = {
  /** Full replacement for `token`. */
  completion: string;
  /** Substring at the end of the line being completed. */
  token: string;
  /** Dim ghost text painted after the cursor (completion beyond token). */
  suffix: string;
};

function suggestionSuffix(token: string, completion: string): string | null {
  if (completion.startsWith(token)) {
    const suffix = completion.slice(token.length);
    return suffix.length > 0 ? suffix : null;
  }
  // Slash commands are typed case-insensitively; keep completion casing in the suffix.
  if (
    token.startsWith("/") &&
    completion.toLowerCase().startsWith(token.toLowerCase())
  ) {
    const suffix = completion.slice(token.length);
    return suffix.length > 0 ? suffix : null;
  }
  return null;
}

/** Pick the top hit for inline ghost + Tab accept. */
export function pickSuggestion(
  hits: string[],
  token: string,
): InlineSuggestion | null {
  if (hits.length === 0) {
    return null;
  }
  const completion = hits[0]!;
  const suffix = suggestionSuffix(token, completion);
  if (!suffix) {
    return null;
  }
  return { completion, token, suffix };
}

/**
 * All completion candidates for a line (may be many).
 * Prefer `completeLine` / `inlineSuggestion` for Tab + ghost UX.
 */
export function listCompletions(line: string): [string[], string] {
  const atToken = line.match(/^\/(?:files|f|browse)\s+(@\S*)$/i);
  if (atToken) {
    const token = atToken[1]!;
    const hits = matchFilesAtAgents(line) ?? [];
    if (hits.length === 0) {
      return [[], token];
    }
    return [hits.map((id) => `@${id}`), token];
  }

  const remoteAgents = matchFilesRemoteAgents(line);
  if (remoteAgents !== null) {
    const token = line.match(/\s+(\S*)$/)?.[1] ?? "";
    if (remoteAgents.length === 0) {
      return [[], token];
    }
    return [remoteAgents, token];
  }

  // Remote path completion is async (fleet fs.list) — handled in main.ts.
  const remotePath = matchFilesRemotePath(line);
  if (remotePath) {
    return [[], remotePath.pathPrefix];
  }

  const localPath = matchFilesLocalPath(line);
  if (localPath !== null) {
    const hits: string[] = [];
    // First token may still be a partial `remote` keyword.
    if (
      !localPath.includes(" ") &&
      !localPath.startsWith("/") &&
      !localPath.startsWith("~")
    ) {
      if (
        "remote".startsWith(localPath.toLowerCase()) &&
        localPath.toLowerCase() !== "remote"
      ) {
        hits.push("remote");
      }
    }
    hits.push(...completeLocalPath(localPath));
    return [hits, localPath];
  }

  if (!line.startsWith("/")) {
    return [[], line];
  }
  // Don't treat `/files …` etc. as slash-command completion.
  if (/\s/.test(line)) {
    return [[], line];
  }
  const lower = line.toLowerCase();
  const names = allCommandNames();
  const exact = names.filter((name) => name === lower);
  if (exact.length > 0) {
    return [exact, line];
  }
  // Bare `/` → canonical names only (skip aliases) for a clean ghost.
  if (lower === "/") {
    return [SLASH_COMMANDS.map((cmd) => cmd.name), line];
  }
  const hits = names.filter((name) => name.startsWith(lower));
  return [hits, line];
}

/** Inline ghost suggestion for the current line (sync contexts only). */
export function inlineSuggestion(line: string): InlineSuggestion | null {
  const [hits, token] = listCompletions(line);
  return pickSuggestion(hits, token);
}

/**
 * readline completer: returns a single preferred match so Tab accepts the
 * inline ghost without dumping a match list below the prompt.
 */
export function completeLine(line: string): [string[], string] {
  const [hits, token] = listCompletions(line);
  const pick = pickSuggestion(hits, token);
  if (!pick) {
    return [[], token];
  }
  return [[pick.completion], token];
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

/** `/files|/f|/browse` with optional start directory or remote target. */
export function isFilesCommand(text: string): boolean {
  return /^\/(?:files|f|browse)(?:\s+\S[\s\S]*)?$/i.test(text.trim());
}

export type FilesCommandParse = {
  mode: "local" | "remote";
  agentId?: string;
  startPath?: string;
};

/**
 * Parse `/files` variants:
 * - `/files [dir]`
 * - `/files remote [agentId] [dir]`
 * - `/files @agentId [dir]`
 */
export function parseFilesCommand(text: string): FilesCommandParse | null {
  const match = text
    .trim()
    .match(/^\/(?:files|f|browse)(?:\s+([\s\S]+))?$/i);
  if (!match) {
    return null;
  }
  const rest = match[1]?.trim() ?? "";
  if (!rest) {
    return { mode: "local" };
  }

  const at = rest.match(/^@(\S+)(?:\s+([\s\S]+))?$/);
  if (at) {
    const out: FilesCommandParse = { mode: "remote", agentId: at[1] };
    const startPath = at[2]?.trim();
    if (startPath) out.startPath = startPath;
    return out;
  }

  const remote = rest.match(/^remote(?:\s+(\S+))?(?:\s+([\s\S]+))?$/i);
  if (remote) {
    const maybeAgent = remote[1];
    const maybePath = remote[2]?.trim();
    // `/files remote /var/www` — first token looks like a path, not an agent id
    if (maybeAgent && (maybeAgent.startsWith("/") || maybeAgent.startsWith("~"))) {
      const startPath = [maybeAgent, maybePath].filter(Boolean).join(" ");
      return { mode: "remote", startPath };
    }
    const out: FilesCommandParse = { mode: "remote" };
    if (maybeAgent) out.agentId = maybeAgent;
    if (maybePath) out.startPath = maybePath;
    return out;
  }

  return { mode: "local", startPath: rest };
}

const EXACT_COMMANDS = new Set(allCommandNames());

/** True for `/console` and `/console …` subcommands. */
export function isConsoleCommand(text: string): boolean {
  const head = text.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return head === "/console" || head === "/cn";
}

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
  if (isConsoleCommand(trimmed)) {
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
  if (isFilesCommand(trimmed)) {
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
