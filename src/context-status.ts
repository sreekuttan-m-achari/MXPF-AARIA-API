import {
  loadFleetMarkdown,
  loadPersonaMarkdown,
  loadUserMarkdown,
  agentCwd,
  resolveUserFilePath,
} from "./persona.js";
import {
  memoryUsage,
  userLearnedCharLimit,
} from "./learn/memory-store.js";
import { getUsageSnapshot } from "./usage.js";
import { existsSync, readFileSync } from "node:fs";

const LEARNED_SECTION = "## Learned (auto)";

export type ContextStatus = {
  window: {
    usedTokens: number | null;
    limitTokens: number;
    percent: number | null;
    model?: string;
  };
  prompts: {
    soulChars: number;
    userChars: number;
    userLearnedChars: number;
    userLearnedLimit: number;
    memoryChars: number;
    memoryLimit: number;
    memoryEntries: number;
    fleetChars: number;
    standingChars: number;
  };
};

/** Model context window for % estimates. Override with AARIA_CONTEXT_WINDOW_TOKENS. */
export function contextWindowLimitTokens(): number {
  const raw = process.env.AARIA_CONTEXT_WINDOW_TOKENS?.trim();
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 1000) return n;
  }
  return 200_000;
}

function userLearnedChars(cwd: string): number {
  const path = resolveUserFilePath(cwd);
  if (!path || !existsSync(path)) return 0;
  try {
    const text = readFileSync(path, "utf8");
    const idx = text.indexOf(LEARNED_SECTION);
    if (idx === -1) return 0;
    return text.slice(idx).length;
  } catch {
    return 0;
  }
}

export function buildContextStatus(cwd: string = agentCwd()): ContextStatus {
  const usage = getUsageSnapshot();
  const last = usage.lastRun;
  const usedTokens =
    last?.usage && last.status === "finished"
      ? last.usage.inputTokens || null
      : last?.usage?.inputTokens ?? null;
  const limitTokens = contextWindowLimitTokens();
  const percent =
    usedTokens != null && limitTokens > 0
      ? Math.min(100, Math.round((usedTokens / limitTokens) * 1000) / 10)
      : null;

  const soul = loadPersonaMarkdown(cwd) ?? "";
  const user = loadUserMarkdown(cwd) ?? "";
  const fleet = loadFleetMarkdown(cwd) ?? "";
  const mem = memoryUsage(cwd);
  const userLearned = userLearnedChars(cwd);
  const userLimit = userLearnedCharLimit();

  return {
    window: {
      usedTokens,
      limitTokens,
      percent,
      model: last?.model,
    },
    prompts: {
      soulChars: soul.length,
      userChars: user.length,
      userLearnedChars: userLearned,
      userLearnedLimit: userLimit,
      memoryChars: mem.chars,
      memoryLimit: mem.limit,
      memoryEntries: mem.entries,
      fleetChars: fleet.length,
      standingChars: soul.length + user.length + mem.chars + fleet.length,
    },
  };
}

/** One-line status for TUI footers. */
export function formatContextStatusLine(ctx: ContextStatus): string {
  const parts: string[] = [];
  if (ctx.window.percent != null && ctx.window.usedTokens != null) {
    parts.push(
      `ctx ${ctx.window.percent}% (${fmtK(ctx.window.usedTokens)}/${fmtK(ctx.window.limitTokens)})`,
    );
  } else {
    parts.push(`ctx —/${fmtK(ctx.window.limitTokens)}`);
  }
  const memPct = Math.round(
    (ctx.prompts.memoryChars / Math.max(1, ctx.prompts.memoryLimit)) * 100,
  );
  parts.push(
    `mem ${memPct}% (${ctx.prompts.memoryChars}/${ctx.prompts.memoryLimit})`,
  );
  const userPct = Math.round(
    (ctx.prompts.userLearnedChars /
      Math.max(1, ctx.prompts.userLearnedLimit)) *
      100,
  );
  parts.push(
    `user ${userPct}% (${ctx.prompts.userLearnedChars}/${ctx.prompts.userLearnedLimit})`,
  );
  return parts.join(" · ");
}

function fmtK(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return k >= 100 ? `${Math.round(k)}k` : `${k.toFixed(k >= 10 ? 0 : 1)}k`;
  }
  return String(n);
}
