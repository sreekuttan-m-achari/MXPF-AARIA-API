import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { CursorAgentError } from "@cursor/sdk";

import type { AriaAgent } from "./agent.js";
import { createStreamingCollector } from "./stream.js";
import {
  formatMemoryForPrompt,
  loadMemoryEntries,
  memoryFileExists,
  resolveMemoryFilePath,
} from "./learn/memory-store.js";
import { formatSkillsIndex } from "./skills/index.js";
import { voiceCapabilitySummary } from "./tts.js";

const DEFAULT_CANDIDATES = ["SOUL.md", "PROFILE.md"] as const;

function absoluteOrCwd(cwd: string, p: string): string {
  return resolve(cwd, p);
}

export function resolvePersonaFilePath(cwd: string): string | undefined {
  const override = process.env.AGENT_SOUL_PATH?.trim();
  if (override) {
    const p = absoluteOrCwd(cwd, override);
    return existsSync(p) ? p : undefined;
  }
  for (const name of DEFAULT_CANDIDATES) {
    const p = resolve(cwd, name);
    if (existsSync(p)) return p;
  }
  return undefined;
}

export function loadPersonaMarkdown(cwd: string): string | undefined {
  const path = resolvePersonaFilePath(cwd);
  if (!path) return undefined;
  try {
    const text = readFileSync(path, "utf8").trim();
    return text.length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
}

export function resolveUserFilePath(cwd: string): string | undefined {
  const override = process.env.AGENT_USER_PATH?.trim();
  if (override) {
    const p = absoluteOrCwd(cwd, override);
    return existsSync(p) ? p : undefined;
  }
  const p = resolve(cwd, "USER.md");
  return existsSync(p) ? p : undefined;
}

export function loadUserMarkdown(cwd: string): string | undefined {
  const path = resolveUserFilePath(cwd);
  if (!path) return undefined;
  try {
    const text = readFileSync(path, "utf8").trim();
    return text.length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
}

function buildBootstrapUserMessage(
  persona: string,
  userContext?: string,
  memoryContext?: string,
  skillsContext?: string,
): string {
  const parts = [
    "The following block is your standing persona and operating instructions for this entire session.",
    "Internalize it; do not repeat it back verbatim unless the user asks.",
    "Then greet the user warmly in 2–3 short sentences (no tools).",
    "",
    "---",
    "",
    persona,
  ];
  if (memoryContext?.trim()) {
    parts.push(
      "",
      "---",
      "",
      "## Memory (from MEMORY.md)",
      "",
      memoryContext.trim(),
    );
  }
  if (skillsContext?.trim()) {
    parts.push(
      "",
      "---",
      "",
      "## Skills",
      "",
      skillsContext.trim(),
    );
  }
  if (userContext?.trim()) {
    parts.push(
      "",
      "---",
      "",
      "## User context (from USER.md)",
      "",
      userContext.trim(),
    );
  }
  const voice = voiceCapabilitySummary();
  if (voice) {
    parts.push("", "---", "", voice);
  }
  return parts.join("\n");
}

const DEFAULT_TIMEZONE = "Asia/Kolkata";

/** IANA timezone from USER.md `**Timezone:**` or `AARIA_TIMEZONE`. */
export function userTimezone(cwd: string = agentCwd()): string {
  const override = process.env.AARIA_TIMEZONE?.trim();
  if (override) return override;

  const text = loadUserMarkdown(cwd);
  if (text) {
    const match = text.match(/^\s*\*{0,2}\s*timezone\s*\*{0,2}\s*:\s*(.+)$/im);
    if (match) {
      const tz = match[1].replace(/\*/g, "").trim();
      if (tz.length > 0) return tz;
    }
  }

  return DEFAULT_TIMEZONE;
}

export function buildMorningBriefPrompt(
  userContext?: string,
  hostContext?: string,
  timezone?: string,
): string {
  const parts = [
    "First connection of the day on the ARIA work desk — deliver a concise morning brief.",
    "Format: short opener (one line), then 3–5 bullets.",
    "Cover: host health (if provided), session readiness, anything useful from user/memory context, one practical focus for today.",
    "FRIDAY tone: calm, operational, no fluff. Use the user's name if known.",
    "No tools unless something is critically wrong. Stay under ~120 words.",
  ];
  if (timezone?.trim()) {
    parts.push("", `Local date context: ${timezone.trim()}`);
  }
  if (hostContext?.trim()) {
    parts.push("", "## Host snapshot", "", hostContext.trim());
  }
  if (userContext?.trim()) {
    parts.push("", "## User context", "", userContext.trim());
  }
  return parts.join("\n");
}

export function buildGreetingPrompt(userContext?: string): string {
  const parts = [
    "The user just opened the ARIA work desktop (professional lane).",
    "Send a brief greeting in 2–3 short sentences — FRIDAY-like: calm, capable, warm.",
    "You are ARIA (A.A.R.I.A. — Augmented Adaptive Reasoning Intelligence Assistant); 'aria' is fine informally.",
    "You handle work (DevOps, code, servers, planning); Amelia handles home and Home Assistant.",
    "No tools. Do not mention APIs, WebSockets, ports, or technical checks.",
  ];
  if (userContext?.trim()) {
    parts.push(
      "",
      "## User context",
      "",
      userContext.trim(),
    );
  }
  const voice = voiceCapabilitySummary();
  if (voice) {
    parts.push("", voice);
  }
  return parts.join("\n");
}

export function agentCwd(): string {
  return process.env.AARIA_AGENT_CWD?.trim() || process.cwd();
}

/** Preferred name to address the user by, parsed from `**Call me:** X` in USER.md. */
export function userCallName(cwd: string = agentCwd()): string | undefined {
  const text = loadUserMarkdown(cwd);
  if (!text) return undefined;
  const match = text.match(
    /^\s*\*{0,2}\s*(?:call me|name)\s*\*{0,2}\s*:\s*(.+)$/im,
  );
  if (!match) return undefined;
  const name = match[1].replace(/\*/g, "").trim();
  return name.length > 0 ? name : undefined;
}

/** Persona warm-up turn; returns the greeting text when successful. */
export async function bootstrapPersonaIfPresent(
  agent: AriaAgent,
  cwd: string = agentCwd(),
): Promise<string | undefined> {
  const soulOverride = process.env.AGENT_SOUL_PATH?.trim();
  const userOverride = process.env.AGENT_USER_PATH?.trim();
  const path = resolvePersonaFilePath(cwd);
  const persona = loadPersonaMarkdown(cwd);
  const userPath = resolveUserFilePath(cwd);
  const userContext = loadUserMarkdown(cwd);
  const memoryPath = resolveMemoryFilePath(cwd);
  const memoryEntries = loadMemoryEntries(cwd);
  const memoryContext = formatMemoryForPrompt(memoryEntries, cwd);
  const skillsContext = formatSkillsIndex(cwd);

  if (soulOverride && !path) {
    console.error(
      `[persona] AGENT_SOUL_PATH is set (${soulOverride}) but file not found.`,
    );
    return undefined;
  }
  if (userOverride && !userPath) {
    console.error(
      `[persona] AGENT_USER_PATH is set (${userOverride}) but file not found.`,
    );
  }
  if (!persona || !path) return undefined;

  console.error(`[persona] Loading ${path}…`);
  if (userPath && userContext) {
    console.error(`[persona] Loading ${userPath}…`);
  }
  if (memoryFileExists(cwd)) {
    console.error(`[persona] Loading ${memoryPath}…`);
  }

  const collector = createStreamingCollector();

  try {
    const run = await agent.send(
      buildBootstrapUserMessage(persona, userContext, memoryContext, skillsContext),
    );
    for await (const event of run.stream()) {
      collector.handleEvent(event);
    }
    const result = await run.wait();
    if (result.status === "error") {
      console.error("[persona] Warm-up ended with error; continuing.");
      return undefined;
    }
    const greeting = collector.getText().trim();
    console.error("[persona] Ready.");
    return greeting || undefined;
  } catch (err) {
    if (err instanceof CursorAgentError) {
      console.error("[persona] Warm-up failed:", err.message);
      return undefined;
    }
    throw err;
  }
}

export function personaStatus(cwd: string = agentCwd()): {
  soulPath?: string;
  userPath?: string;
  memoryPath?: string;
} {
  return {
    soulPath: resolvePersonaFilePath(cwd),
    userPath: resolveUserFilePath(cwd),
    memoryPath: memoryFileExists(cwd) ? resolveMemoryFilePath(cwd) : undefined,
  };
}
