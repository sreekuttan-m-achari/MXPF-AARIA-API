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

/** Best-effort last-seen from store fields (heartbeat / result / announce). */
export function resolveLastSeen(agent: {
  lastSeenAt?: string;
  lastAnnounceAt?: string;
  lastStatus?: Record<string, unknown>;
  lastResult?: Record<string, unknown>;
}): string | undefined {
  const candidates = [
    agent.lastSeenAt,
    typeof agent.lastStatus?.at === "string" ? agent.lastStatus.at : undefined,
    typeof agent.lastResult?.at === "string" ? agent.lastResult.at : undefined,
    agent.lastAnnounceAt,
  ].filter((x): x is string => typeof x === "string" && x.length > 0);
  if (candidates.length === 0) return undefined;
  return candidates.reduce((a, b) =>
    Date.parse(a) >= Date.parse(b) ? a : b,
  );
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
