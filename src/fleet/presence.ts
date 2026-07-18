/** Derive presence for ops UI from lastSeenAt / status. */
export type FleetPresence = "online" | "idle" | "offline" | "pending";

const ONLINE_MS = 90_000; // 90s — matches ~30s heartbeat with slack
const IDLE_MS = 30 * 60_000;

export function fleetPresence(
  status: string,
  lastSeenAt?: string,
): FleetPresence {
  if (status === "pending") return "pending";
  if (!lastSeenAt) return "offline";
  const age = Date.now() - Date.parse(lastSeenAt);
  if (!Number.isFinite(age) || age < 0) return "offline";
  if (age <= ONLINE_MS) return "online";
  if (age <= IDLE_MS) return "idle";
  return "offline";
}

export function currentTaskLabel(agent: {
  currentJob?: {
    action: string;
    summary?: string;
    jobId: string;
    dispatchedAt: string;
  } | null;
  lastResult?: Record<string, unknown>;
}): string {
  const job = agent.currentJob;
  if (job) {
    const summary = job.summary?.trim();
    if (summary) return `${job.action}: ${summary}`;
    return `${job.action} (${job.jobId.slice(0, 8)}…)`;
  }
  const last = agent.lastResult;
  if (last && typeof last.action === "string") {
    const ok = last.ok === true ? "ok" : last.ok === false ? "fail" : "?";
    return `last ${last.action} · ${ok}`;
  }
  return "—";
}
