import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

import { agentCwd, loadUserMarkdown, resolveUserFilePath } from "../persona.js";

export type MemoryTarget = "memory" | "user";

export type LearnWriteResult =
  | { ok: true; preview: string }
  | { ok: false; error: string };

const ENTRY_SEP = "§";
const LEARNED_SECTION = "## Learned (auto)";

const BLOCKED_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /system\s+prompt\s+override/i,
  /do\s+not\s+tell\s+the\s+user/i,
  /\bcurl\b.*\$[A-Z_]*(?:KEY|TOKEN|SECRET)/i,
  /cat\s+\.env\b/i,
];

function memoryCharLimit(): number {
  const raw = process.env.AARIA_MEMORY_CHAR_LIMIT?.trim() || "2200";
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 200 ? n : 2200;
}

function userLearnedCharLimit(): number {
  const raw = process.env.AARIA_USER_LEARNED_CHAR_LIMIT?.trim() || "1375";
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 100 ? n : 1375;
}

export function resolveMemoryFilePath(cwd: string = agentCwd()): string {
  const override = process.env.AGENT_MEMORY_PATH?.trim();
  if (override) {
    return resolve(cwd, override);
  }
  return resolve(cwd, "MEMORY.md");
}

export function memoryFileExists(cwd: string = agentCwd()): boolean {
  return existsSync(resolveMemoryFilePath(cwd));
}

function defaultHeader(): string {
  return [
    "# AARIA memory (agent notes)",
    "",
    "Durable work-desk facts learned across sessions. One entry per line, prefixed with §.",
    "Do not put persona or user profile here — those live in SOUL.md and USER.md.",
  ].join("\n");
}

export function parseMemoryEntries(raw: string): {
  header: string;
  entries: string[];
} {
  const entries: string[] = [];
  const headerLines: string[] = [];
  let inBody = false;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith(ENTRY_SEP)) {
      inBody = true;
      const entry = trimmed.slice(ENTRY_SEP.length).trim();
      if (entry) entries.push(entry);
      continue;
    }
    if (!inBody && (trimmed.startsWith("#") || trimmed === "")) {
      headerLines.push(line);
      continue;
    }
    if (trimmed.length > 0) {
      inBody = true;
      entries.push(trimmed.replace(/^[-*]\s+/, ""));
    }
  }

  return {
    header: headerLines.join("\n").trim() || defaultHeader(),
    entries,
  };
}

export function loadMemoryEntries(cwd: string = agentCwd()): string[] {
  const path = resolveMemoryFilePath(cwd);
  if (!existsSync(path)) {
    return [];
  }
  try {
    const raw = readFileSync(path, "utf8");
    return parseMemoryEntries(raw).entries;
  } catch {
    return [];
  }
}

export function loadMemoryMarkdown(cwd: string = agentCwd()): string | undefined {
  const path = resolveMemoryFilePath(cwd);
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    const text = readFileSync(path, "utf8").trim();
    return text.length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
}

export function formatMemoryForPrompt(
  entries: string[],
  cwd: string = agentCwd(),
): string | undefined {
  if (entries.length === 0) {
    return undefined;
  }
  const limit = memoryCharLimit();
  const body = entries.map((e) => `${ENTRY_SEP}${e}`).join("\n");
  const used = body.length;
  const pct = Math.round((used / limit) * 100);
  return [
    `MEMORY (agent notes) [${pct}% — ${used}/${limit} chars]`,
    "",
    body,
  ].join("\n");
}

function serializeMemory(header: string, entries: string[]): string {
  const body = entries.map((e) => `${ENTRY_SEP}${e}`).join("\n");
  return `${header}\n\n${body}\n`;
}

export function memoryUsage(cwd: string = agentCwd()): {
  chars: number;
  limit: number;
  entries: number;
} {
  const entries = loadMemoryEntries(cwd);
  const body = entries.map((e) => `${ENTRY_SEP}${e}`).join("\n");
  return { chars: body.length, limit: memoryCharLimit(), entries: entries.length };
}

function scanContent(content: string): string | undefined {
  const trimmed = content.trim();
  if (!trimmed) {
    return "empty entry";
  }
  if (trimmed.length > 400) {
    return "entry too long (max 400 chars)";
  }
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(trimmed)) {
      return "entry blocked by safety scan";
    }
  }
  return undefined;
}

export function addMemoryEntry(
  content: string,
  cwd: string = agentCwd(),
): LearnWriteResult {
  const blocked = scanContent(content);
  if (blocked) {
    return { ok: false, error: blocked };
  }

  const path = resolveMemoryFilePath(cwd);
  const limit = memoryCharLimit();
  const { header, entries } = existsSync(path)
    ? parseMemoryEntries(readFileSync(path, "utf8"))
    : { header: defaultHeader(), entries: [] as string[] };

  const normalized = content.trim();
  if (entries.some((e) => e.toLowerCase() === normalized.toLowerCase())) {
    return { ok: true, preview: normalized };
  }

  const nextBody = [...entries, normalized]
    .map((e) => `${ENTRY_SEP}${e}`)
    .join("\n");
  if (nextBody.length > limit) {
    return {
      ok: false,
      error: `MEMORY at ${nextBody.length - normalized.length}/${limit} chars — consolidate or remove entries before adding`,
    };
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeMemory(header, [...entries, normalized]), "utf8");
  return { ok: true, preview: normalized };
}

function appendUserLearned(
  content: string,
  cwd: string = agentCwd(),
): LearnWriteResult {
  const blocked = scanContent(content);
  if (blocked) {
    return { ok: false, error: blocked };
  }

  const path = resolveUserFilePath(cwd);
  if (!path || !existsSync(path)) {
    return { ok: false, error: "USER.md not found — copy USER.sample.md first" };
  }

  const normalized = content.trim();
  const line = `- ${normalized}`;
  let text = readFileSync(path, "utf8");

  if (text.toLowerCase().includes(normalized.toLowerCase())) {
    return { ok: true, preview: normalized };
  }

  const sectionIdx = text.indexOf(LEARNED_SECTION);
  if (sectionIdx === -1) {
    const addition = `\n\n${LEARNED_SECTION}\n${line}\n`;
    if (addition.length > userLearnedCharLimit()) {
      return { ok: false, error: "USER learned section would exceed limit" };
    }
    text = `${text.trimEnd()}${addition}`;
  } else {
    const before = text.slice(0, sectionIdx);
    const after = text.slice(sectionIdx);
    const next = `${before}${after.trimEnd()}\n${line}\n`;
    const learnedPart = next.slice(sectionIdx);
    if (learnedPart.length > userLearnedCharLimit()) {
      return {
        ok: false,
        error: "USER learned section full — edit USER.md or remove stale bullets",
      };
    }
    text = next;
  }

  writeFileSync(path, text, "utf8");
  return { ok: true, preview: normalized };
}

export function applyLearnEntry(
  target: MemoryTarget,
  content: string,
  cwd: string = agentCwd(),
): LearnWriteResult {
  return target === "user"
    ? appendUserLearned(content, cwd)
    : addMemoryEntry(content, cwd);
}

/** Snapshot for the learn-review prompt (not the full USER.md prose). */
export function memoryContextForReview(cwd: string = agentCwd()): {
  memoryEntries: string[];
  userMarkdown?: string;
} {
  return {
    memoryEntries: loadMemoryEntries(cwd),
    userMarkdown: loadUserMarkdown(cwd),
  };
}
