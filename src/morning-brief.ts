import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { AriaAgent } from "./agent.js";
import { enqueueAgentWork } from "./agent-queue.js";
import { handleChatTurn } from "./chat.js";
import {
  agentCwd,
  buildMorningBriefPrompt,
  loadUserMarkdown,
  userTimezone,
} from "./persona.js";
import { collectHeartbeatSnapshot } from "./scheduler/heartbeat.js";
import type { HeartbeatSnapshot } from "./scheduler/types.js";
import { morningBriefDatePath, sessionDir } from "./session.js";
import { waitForWarmup } from "./warmup.js";

function envFlag(name: string, defaultOn = true): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return defaultOn;
  return raw !== "0" && raw !== "false" && raw !== "no" && raw !== "off";
}

export function morningBriefEnabled(): boolean {
  return envFlag("AARIA_MORNING_BRIEF", true);
}

function todayKey(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function readLastDeliveredDate(cwd: string): string | undefined {
  const path = morningBriefDatePath(cwd);
  if (!existsSync(path)) return undefined;
  const value = readFileSync(path, "utf8").trim();
  return value.length > 0 ? value : undefined;
}

function writeLastDeliveredDate(cwd: string, date: string): void {
  sessionDir(cwd);
  writeFileSync(morningBriefDatePath(cwd), `${date}\n`, "utf8");
}

function formatSnapshotForPrompt(snapshot: HeartbeatSnapshot): string {
  const lines = [
    `Host memory: ${snapshot.memory.usedPercent}% used (${snapshot.memory.freeMb} MB free / ${snapshot.memory.totalMb} MB)`,
    `Load (1/5/15m): ${snapshot.load.one} / ${snapshot.load.five} / ${snapshot.load.fifteen}`,
    `ARIA warm: ${snapshot.warm ? "yes" : "no"}`,
  ];
  if (snapshot.warnings.length > 0) {
    lines.push(`Warnings: ${snapshot.warnings.join("; ")}`);
  }
  return lines.join("\n");
}

let briefInFlight: Promise<string | undefined> | undefined;

export function isMorningBriefInFlight(): boolean {
  return briefInFlight !== undefined;
}

export function morningBriefStatus(cwd: string = agentCwd()): {
  enabled: boolean;
  timezone: string;
  today: string;
  lastDelivered?: string;
  due: boolean;
} {
  const timezone = userTimezone(cwd);
  const today = todayKey(timezone);
  const lastDelivered = readLastDeliveredDate(cwd);
  return {
    enabled: morningBriefEnabled(),
    timezone,
    today,
    lastDelivered,
    due: morningBriefEnabled() && lastDelivered !== today,
  };
}

/** Run once per calendar day (user timezone); concurrent connects share the same turn. */
export async function deliverMorningBriefIfDue(
  agent: AriaAgent,
  onChunk?: (text: string) => void,
): Promise<string | undefined> {
  if (!morningBriefEnabled()) return undefined;

  const cwd = agentCwd();
  const { due, today, timezone } = morningBriefStatus(cwd);
  if (!due) return undefined;

  if (!briefInFlight) {
    briefInFlight = runMorningBrief(agent, cwd, today, timezone, onChunk).finally(() => {
      briefInFlight = undefined;
    });
  }

  return briefInFlight;
}

async function runMorningBrief(
  agent: AriaAgent,
  cwd: string,
  today: string,
  timezone: string,
  onChunk?: (text: string) => void,
): Promise<string | undefined> {
  if (readLastDeliveredDate(cwd) === today) {
    return undefined;
  }

  try {
    await waitForWarmup();
    const snapshot = collectHeartbeatSnapshot();
    const userContext = loadUserMarkdown(cwd);
    const message = buildMorningBriefPrompt(
      userContext,
      formatSnapshotForPrompt(snapshot),
      timezone,
    );
    const id = `morning-brief:${today}`;
    const reply = await enqueueAgentWork(() =>
      handleChatTurn(agent, "brief", id, message, onChunk, true, { learn: false }),
    );
    writeLastDeliveredDate(cwd, today);
    console.error(`[morning-brief] delivered for ${today} (${reply.length} chars)`);
    return reply.trim() || undefined;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[morning-brief] failed for ${today}: ${msg}`);
    return undefined;
  }
}
