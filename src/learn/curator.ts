import { createStreamingCollector } from "../stream.js";
import { withAgentBusyRecovery } from "../agent-busy.js";
import {
  loadMemoryEntries,
  memoryCharLimit,
  memoryUsage,
  parseMemoryEntries,
  replaceMemoryEntries,
  replaceUserLearnedEntries,
  resolveMemoryFilePath,
  userLearnedCharLimit,
} from "./memory-store.js";
import { getReviewAgent } from "./review-agent.js";
import { loadUserMarkdown } from "../persona.js";
import { agentCwd } from "../persona.js";
import { existsSync, readFileSync } from "node:fs";

export type CuratorResult =
  | {
      ok: true;
      memoryBefore: number;
      memoryAfter: number;
      userBefore: number;
      userAfter: number;
      pruned: boolean;
    }
  | { ok: false; error: string };

const LEARNED_SECTION = "## Learned (auto)";

function curatorEnabled(): boolean {
  const v = process.env.AARIA_CURATOR?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no") {
    return false;
  }
  return true;
}

export function curatorThreshold(): number {
  const raw = process.env.AARIA_CURATOR_THRESHOLD?.trim() || "0.85";
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : 0.85;
}

export function shouldRunCurator(cwd: string = agentCwd()): boolean {
  if (!curatorEnabled()) return false;
  const mem = memoryUsage(cwd);
  const memRatio = mem.chars / mem.limit;
  if (memRatio >= curatorThreshold()) return true;

  const userText = loadUserMarkdown(cwd);
  if (!userText) return false;
  const idx = userText.indexOf(LEARNED_SECTION);
  if (idx === -1) return false;
  const learned = userText.slice(idx);
  return learned.length >= userLearnedCharLimit() * curatorThreshold();
}

function parseUserLearnedBullets(userMarkdown: string): string[] {
  const idx = userMarkdown.indexOf(LEARNED_SECTION);
  if (idx === -1) return [];
  const after = userMarkdown.slice(idx + LEARNED_SECTION.length);
  const bullets: string[] = [];
  for (const line of after.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("- ")) {
      bullets.push(trimmed.slice(2).trim());
    }
  }
  return bullets;
}

function buildCuratorPrompt(cwd: string): string {
  const memLimit = memoryCharLimit();
  const userLimit = userLearnedCharLimit();
  const memoryEntries = loadMemoryEntries(cwd);
  const userMarkdown = loadUserMarkdown(cwd) ?? "";
  const userBullets = parseUserLearnedBullets(userMarkdown);

  const memoryBlock =
    memoryEntries.length > 0
      ? memoryEntries.map((e) => `- ${e}`).join("\n")
      : "(empty)";
  const userBlock =
    userBullets.length > 0
      ? userBullets.map((e) => `- ${e}`).join("\n")
      : "(empty)";

  return [
    "You are the memory curator for AARIA (work-desk assistant).",
    "Consolidate durable facts — do NOT reply to the user.",
    "",
    "Goals:",
    `- Merge duplicates and near-duplicates in MEMORY (target ≤${Math.floor(memLimit * 0.75)} chars total body)`,
    `- Prune stale/ephemeral items; keep environment facts, paths, tooling, conventions`,
    `- Consolidate USER learned bullets (target ≤${Math.floor(userLimit * 0.75)} chars)`,
    "- Preserve all still-relevant information; compress wording",
    "",
    "Reply with ONLY valid JSON (no markdown fences):",
    '{"memory":["entry",...],"userLearned":["bullet",...]}',
    "Each memory entry ≤200 chars, no § prefix. Each user bullet ≤200 chars, no leading dash.",
    "",
    "## Current MEMORY",
    memoryBlock,
    "",
    "## Current USER learned",
    userBlock,
  ].join("\n");
}

function parseCuratorJson(text: string): {
  memory: string[];
  userLearned: string[];
} | null {
  const match = text.trim().match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as {
      memory?: unknown;
      userLearned?: unknown;
    };
    const memory = Array.isArray(parsed.memory)
      ? parsed.memory
          .filter((e): e is string => typeof e === "string")
          .map((e) => e.trim())
          .filter((e) => e.length > 0 && e.length <= 200)
      : [];
    const userLearned = Array.isArray(parsed.userLearned)
      ? parsed.userLearned
          .filter((e): e is string => typeof e === "string")
          .map((e) => e.trim())
          .filter((e) => e.length > 0 && e.length <= 200)
      : [];
    return { memory, userLearned };
  } catch {
    return null;
  }
}

export async function runCurator(
  cwd: string = agentCwd(),
): Promise<CuratorResult> {
  if (!curatorEnabled()) {
    return { ok: false, error: "curator disabled" };
  }

  const beforeMem = memoryUsage(cwd);
  const userMarkdown = loadUserMarkdown(cwd) ?? "";
  const beforeUser = parseUserLearnedBullets(userMarkdown).join("\n").length;

  const agent = await getReviewAgent();
  const prompt = buildCuratorPrompt(cwd);
  const collector = createStreamingCollector();

  await withAgentBusyRecovery(agent.agentId, async () => {
    const run = await agent.send(prompt);
    for await (const event of run.stream()) {
      collector.handleEvent(event);
    }
    const result = await run.wait();
    if (result.status === "error") {
      throw new Error("curator LLM run failed");
    }
  });

  const parsed = parseCuratorJson(collector.getText());
  if (!parsed) {
    return { ok: false, error: "curator returned invalid JSON" };
  }

  if (parsed.memory.length > 0) {
    const memPath = resolveMemoryFilePath(cwd);
    const header = existsSync(memPath)
      ? parseMemoryEntries(readFileSync(memPath, "utf8")).header
      : undefined;
    replaceMemoryEntries(parsed.memory, cwd, header);
  }

  if (parsed.userLearned.length > 0) {
    replaceUserLearnedEntries(parsed.userLearned, cwd);
  }

  const afterMem = memoryUsage(cwd);
  const afterUserMarkdown = loadUserMarkdown(cwd) ?? "";
  const afterUser = parseUserLearnedBullets(afterUserMarkdown).join("\n").length;
  const pruned =
    afterMem.chars < beforeMem.chars || afterUser < beforeUser;

  console.error(
    `[curator] memory ${beforeMem.chars}→${afterMem.chars} user ${beforeUser}→${afterUser}`,
  );

  return {
    ok: true,
    memoryBefore: beforeMem.chars,
    memoryAfter: afterMem.chars,
    userBefore: beforeUser,
    userAfter: afterUser,
    pruned,
  };
}

export function curatorStatus(): {
  enabled: boolean;
  threshold: number;
  shouldRun: boolean;
} {
  return {
    enabled: curatorEnabled(),
    threshold: curatorThreshold(),
    shouldRun: shouldRunCurator(),
  };
}
