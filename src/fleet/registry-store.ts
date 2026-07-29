import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { agentCwd } from "../persona.js";

const CurrentJobSchema = z
  .object({
    jobId: z.string().min(1),
    action: z.string().min(1),
    summary: z.string().optional(),
    dispatchedAt: z.string().min(1),
  })
  .nullable()
  .optional();

const AgentRecordSchema = z.object({
  agentId: z.string().min(1),
  name: z.string().optional(),
  hostname: z.string().optional(),
  labels: z.record(z.string(), z.string()).default({}),
  caps: z.array(z.string()).default([]),
  status: z.enum(["pending", "approved", "rejected"]),
  lastAnnounceAt: z.string().optional(),
  approvedAt: z.string().optional(),
  lastSeenAt: z.string().optional(),
  lastStatus: z.record(z.string(), z.unknown()).optional(),
  lastResult: z.record(z.string(), z.unknown()).optional(),
  currentJob: CurrentJobSchema,
  host: z
    .object({
      purpose: z.string(),
      os: z.string().optional(),
      arch: z.string().optional(),
      summary: z.string(),
      updatedAt: z.string(),
      hash: z.string(),
    })
    .optional(),
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
    host?: AgentRecord["host"];
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
    lastSeenAt: new Date().toISOString(),
    approvedAt: existing?.approvedAt,
    lastStatus: existing?.lastStatus,
    lastResult: existing?.lastResult,
    currentJob: existing?.currentJob ?? null,
    host: input.host ?? existing?.host,
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
  existing.lastSeenAt = new Date().toISOString();
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
  existing.lastSeenAt = new Date().toISOString();
  const jobId = typeof result.jobId === "string" ? result.jobId : undefined;
  if (
    existing.currentJob &&
    (!jobId || existing.currentJob.jobId === jobId)
  ) {
    existing.currentJob = null;
  }

  // Persist full HOST.md when host.profile returns markdown
  if (
    result.action === "host.profile" ||
    result.action === "host"
  ) {
    const data = result.data;
    if (data && typeof data === "object") {
      const d = data as Record<string, unknown>;
      const markdown =
        typeof d.markdown === "string" ? d.markdown : undefined;
      if (markdown && existing.host) {
        const { writeHostMirror } = await import("./host-profile.js");
        const purpose =
          typeof d.purpose === "string" ? d.purpose : existing.host.purpose;
        const nextHost = {
          ...existing.host,
          purpose,
          os: typeof d.os === "string" ? d.os : existing.host.os,
          arch: typeof d.arch === "string" ? d.arch : existing.host.arch,
          summary: markdown.slice(0, 4 * 1024),
          updatedAt:
            typeof d.updatedAt === "string"
              ? d.updatedAt
              : new Date().toISOString(),
          hash:
            typeof d.hash === "string" ? d.hash : existing.host.hash,
        };
        existing.host = nextHost;
        await writeHostMirror(agentId, nextHost, markdown, cwd);
      }
    }
  }

  store.agents[agentId] = existing;
  await writeStore(store, cwd);
}

export async function setCurrentJob(
  agentId: string,
  job: {
    jobId: string;
    action: string;
    summary?: string;
  },
  cwd?: string,
): Promise<void> {
  const store = await readStore(cwd);
  const existing = store.agents[agentId];
  if (!existing) return;
  existing.currentJob = {
    jobId: job.jobId,
    action: job.action,
    summary: job.summary,
    dispatchedAt: new Date().toISOString(),
  };
  store.agents[agentId] = existing;
  await writeStore(store, cwd);
}
