import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { agentCwd } from "../persona.js";

const AgentRecordSchema = z.object({
  agentId: z.string().min(1),
  name: z.string().optional(),
  hostname: z.string().optional(),
  labels: z.record(z.string(), z.string()).default({}),
  caps: z.array(z.string()).default([]),
  status: z.enum(["pending", "approved", "rejected"]),
  lastAnnounceAt: z.string().optional(),
  approvedAt: z.string().optional(),
  lastStatus: z.record(z.string(), z.unknown()).optional(),
  lastResult: z.record(z.string(), z.unknown()).optional(),
});

export type AgentRecord = z.infer<typeof AgentRecordSchema>;

const StoreSchema = z.object({
  agents: z.record(z.string(), AgentRecordSchema).default({}),
});

function storePath(cwd: string = agentCwd()): string {
  return path.join(cwd, "data", "fleet", "agents.json");
}

async function readStore(cwd?: string): Promise<z.infer<typeof StoreSchema>> {
  const file = storePath(cwd);
  try {
    const raw = await readFile(file, "utf8");
    return StoreSchema.parse(JSON.parse(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { agents: {} };
    }
    throw err;
  }
}

async function writeStore(
  store: z.infer<typeof StoreSchema>,
  cwd?: string,
): Promise<void> {
  const file = storePath(cwd);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export async function listAgents(cwd?: string): Promise<AgentRecord[]> {
  const store = await readStore(cwd);
  return Object.values(store.agents);
}

export async function getAgent(
  agentId: string,
  cwd?: string,
): Promise<AgentRecord | undefined> {
  const store = await readStore(cwd);
  return store.agents[agentId];
}

export async function upsertPending(
  input: {
    agentId: string;
    name?: string;
    hostname?: string;
    labels?: Record<string, string>;
    caps?: string[];
  },
  cwd?: string,
): Promise<AgentRecord> {
  const store = await readStore(cwd);
  const existing = store.agents[input.agentId];
  const record: AgentRecord = {
    agentId: input.agentId,
    name: input.name ?? existing?.name,
    hostname: input.hostname ?? existing?.hostname,
    labels: input.labels ?? existing?.labels ?? {},
    caps: input.caps ?? existing?.caps ?? [],
    status: existing?.status === "approved" ? "approved" : "pending",
    lastAnnounceAt: new Date().toISOString(),
    approvedAt: existing?.approvedAt,
    lastStatus: existing?.lastStatus,
    lastResult: existing?.lastResult,
  };
  store.agents[input.agentId] = AgentRecordSchema.parse(record);
  await writeStore(store, cwd);
  return store.agents[input.agentId]!;
}

export async function approveAgent(
  agentId: string,
  labels?: Record<string, string>,
  caps?: string[],
  cwd?: string,
): Promise<AgentRecord> {
  const store = await readStore(cwd);
  const existing = store.agents[agentId] ?? {
    agentId,
    labels: {},
    caps: [],
    status: "pending" as const,
  };
  const record: AgentRecord = {
    ...existing,
    agentId,
    labels: labels ?? existing.labels,
    caps: caps ?? existing.caps,
    status: "approved",
    approvedAt: new Date().toISOString(),
  };
  store.agents[agentId] = AgentRecordSchema.parse(record);
  await writeStore(store, cwd);
  return store.agents[agentId]!;
}

export async function recordAgentStatus(
  agentId: string,
  status: Record<string, unknown>,
  cwd?: string,
): Promise<void> {
  const store = await readStore(cwd);
  const existing = store.agents[agentId];
  if (!existing) return;
  existing.lastStatus = status;
  store.agents[agentId] = existing;
  await writeStore(store, cwd);
}

export async function recordAgentResult(
  agentId: string,
  result: Record<string, unknown>,
  cwd?: string,
): Promise<void> {
  const store = await readStore(cwd);
  const existing = store.agents[agentId];
  if (!existing) return;
  existing.lastResult = result;
  store.agents[agentId] = existing;
  await writeStore(store, cwd);
}
