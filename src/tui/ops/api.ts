import { apiBase } from "../config.js";
import type { Health } from "../bootstrap.js";

export type HeartbeatSnapshot = {
  at: string;
  ok: boolean;
  warm: boolean;
  memory: { totalMb: number; freeMb: number; usedPercent: number };
  load: { one: number; five: number; fifteen: number };
  uptimeSec: number;
  process: { rssMb: number; heapUsedMb: number };
  warnings: string[];
};

export type JobState = {
  id: string;
  type: string;
  enabled: boolean;
  status: string;
  lastRunAt?: string;
  lastOkAt?: string;
  lastError?: string;
  lastDurationMs?: number;
  runCount: number;
  nextRunAt?: string;
};

export type PendingEntry = {
  id: string;
  target: string;
  content: string;
};

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) {
    throw new Error(`${path} returned ${res.status}`);
  }
  return (await res.json()) as T;
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    method: "POST",
    headers: body != null ? { "Content-Type": "application/json" } : undefined,
    body: body != null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok || (data as { error?: string }).error) {
    throw new Error((data as { error?: string }).error ?? `${path} failed (${res.status})`);
  }
  return data;
}

export async function fetchOpsHealth(): Promise<Health> {
  return getJson<Health>("/health");
}

export async function fetchHeartbeat(): Promise<HeartbeatSnapshot | null> {
  const body = await getJson<{ snapshot: HeartbeatSnapshot | null }>("/heartbeat");
  return body.snapshot;
}

export async function fetchJobs(): Promise<JobState[]> {
  const body = await getJson<{ jobs: JobState[] }>("/jobs");
  return body.jobs ?? [];
}

export async function runJob(id: string): Promise<void> {
  await postJson("/jobs/run", { id });
}

export async function fetchPending(): Promise<PendingEntry[]> {
  const body = await getJson<{ pending: PendingEntry[] }>("/memory/pending");
  return body.pending ?? [];
}

export async function approvePending(id: string): Promise<void> {
  await postJson("/memory/approve", { id });
}

export async function rejectPending(id: string): Promise<void> {
  await postJson("/memory/reject", { id });
}

export type CursorStatus = {
  ok: boolean;
  config: {
    model: string;
    learnModel: string;
    apiKeyConfigured: boolean;
    apiKeyHint: string;
    agentCwd: string;
    sessionId?: string;
    warm: boolean;
    sdkVersion?: string;
  };
  account: {
    apiKeyName: string;
    userId?: number;
    userEmail?: string;
    userFirstName?: string;
    userLastName?: string;
    createdAt: string;
  } | null;
  accountError?: string;
  models: { at: string; count: number; ids: string[] } | null;
  usage: {
    since: string;
    runs: { total: number; finished: number; error: number; cancelled: number };
    tokens: {
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      totalTokens: number;
      reasoningTokens: number;
    };
    lastRun: {
      at: string;
      id: string;
      status: string;
      model?: string;
      durationMs?: number;
      usage?: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      };
    } | null;
    recent: Array<{
      at: string;
      id: string;
      status: string;
      model?: string;
      durationMs?: number;
    }>;
  };
};

export async function fetchCursorStatus(): Promise<CursorStatus> {
  return getJson<CursorStatus>("/cursor");
}

export type FleetPresence = "online" | "idle" | "offline" | "pending";

export type FleetAgent = {
  agentId: string;
  name?: string;
  hostname?: string;
  labels: Record<string, string>;
  caps: string[];
  status: string;
  presence: FleetPresence;
  task: string;
  lastSeenAt?: string;
  lastAnnounceAt?: string;
  approvedAt?: string;
  currentJob?: {
    jobId: string;
    action: string;
    summary?: string;
    dispatchedAt: string;
  } | null;
  lastResult?: Record<string, unknown>;
};

export type FleetHub = {
  provider: string;
  host: string;
  username: string;
  messagesIn: number;
  messagesOut: number;
  lastTrafficAt?: string;
  lastTopic?: string;
  subscriptions: string[];
  connectedSince?: string;
};

export type FleetSnapshot = {
  ok: boolean;
  enabled: boolean;
  connected: boolean;
  hub: FleetHub | null;
  agents: FleetAgent[];
};

export async function fetchFleet(): Promise<FleetSnapshot> {
  return getJson<FleetSnapshot>("/fleet/agents");
}

export async function approveFleetAgent(
  agentId: string,
  labels?: Record<string, string>,
  caps?: string[],
): Promise<void> {
  await postJson("/fleet/approve", { agentId, labels, caps });
}

export async function fleetCmd(
  agentId: string,
  action: string,
  args?: Record<string, unknown>,
): Promise<{ jobId: string }> {
  return postJson<{ jobId: string }>("/fleet/cmd", { agentId, action, args });
}

export function opsEnabled(): boolean {
  const raw = process.env.AARIA_OPS?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") {
    return false;
  }
  return true;
}
