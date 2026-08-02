import {
  makeEnvelope,
  parseEnvelope,
  serializeEnvelope,
} from "./envelope.js";
import { syncFleetMarkdown } from "./fleet-md.js";
import { parseHostPayload, writeHostMirror } from "./host-profile.js";
import {
  approveAgent,
  getAgent,
  listAgents,
  recordAgentResult,
  recordAgentStatus,
  setCurrentJob,
  upsertPending,
  type AgentRecord,
} from "./registry-store.js";
import { currentTaskLabel, fleetPresence, resolveLastSeen } from "./presence.js";
import { topics } from "./topics.js";
import type { FleetBus } from "./bus.js";
import {
  dispatchArgsForAgent,
  resolveUpdateTargets,
  type FleetUpdateOptions,
  type FleetUpdateResult,
} from "./update.js";

export type FleetAgentView = AgentRecord & {
  presence: ReturnType<typeof fleetPresence>;
  task: string;
};

export function toFleetAgentView(agent: AgentRecord): FleetAgentView {
  const lastSeenAt = resolveLastSeen(agent) ?? agent.lastSeenAt;
  return {
    ...agent,
    lastSeenAt,
    presence: fleetPresence(agent.status, lastSeenAt),
    task: currentTaskLabel(agent),
  };
}

export async function listFleetAgentsView(): Promise<FleetAgentView[]> {
  const agents = await listAgents();
  return agents.map(toFleetAgentView);
}

const DEFAULT_APPROVE_CAPS = ["health", "exec", "fs", "host", "update"];

export type FleetCmdResult = {
  jobId: string;
  ok: boolean;
  action: string;
  data?: unknown;
  error?: string;
};

export type FleetBridge = {
  bus: FleetBus;
  listAgents: () => Promise<FleetAgentView[]>;
  approve: (
    agentId: string,
    labels?: Record<string, string>,
    caps?: string[],
  ) => Promise<AgentRecord>;
  dispatchCmd: (
    agentId: string,
    action: string,
    args?: Record<string, unknown>,
  ) => Promise<{ jobId: string }>;
  /** Dispatch and wait for MQTT result (or timeout). */
  dispatchCmdWait: (
    agentId: string,
    action: string,
    args?: Record<string, unknown>,
    timeoutMs?: number,
  ) => Promise<FleetCmdResult>;
  updateAgents: (opts?: FleetUpdateOptions) => Promise<FleetUpdateResult>;
  stop: () => Promise<void>;
};

type JobWaiter = {
  resolve: (result: FleetCmdResult) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export async function startFleetBridge(bus: FleetBus): Promise<FleetBridge> {
  const waiters = new Map<string, JobWaiter>();

  const settleWaiter = (jobId: string, result: FleetCmdResult): void => {
    const waiter = waiters.get(jobId);
    if (!waiter) return;
    waiters.delete(jobId);
    clearTimeout(waiter.timer);
    waiter.resolve(result);
  };
  const onAnnounce = async (_topic: string, payload: Buffer) => {
    try {
      const env = parseEnvelope(payload);
      const name =
        typeof env.payload.name === "string" ? env.payload.name : undefined;
      const hostname =
        typeof env.payload.hostname === "string"
          ? env.payload.hostname
          : undefined;
      const labels =
        env.payload.labels && typeof env.payload.labels === "object"
          ? (env.payload.labels as Record<string, string>)
          : {};
      const caps = Array.isArray(env.payload.caps)
        ? (env.payload.caps as string[])
        : [];
      const host = parseHostPayload(env.payload.host);
      await upsertPending({
        agentId: env.agentId,
        name,
        hostname,
        labels,
        caps,
        host,
      });
      if (host) {
        await writeHostMirror(env.agentId, host);
        const all = await listAgents();
        await syncFleetMarkdown(all);
      }
      console.error(
        `[fleet] pending announce from ${env.agentId}${host ? ` purpose=${host.purpose}` : ""}`,
      );
    } catch (err) {
      console.error("[fleet] bad announce:", err);
    }
  };

  await bus.subscribe(topics.announce, onAnnounce, 1);
  await bus.subscribe("mxpf/v1/registry/pending/+", onAnnounce, 1);

  await bus.subscribe(
    "mxpf/v1/agents/+/status",
    async (topic, payload) => {
      try {
        const env = parseEnvelope(payload);
        await recordAgentStatus(env.agentId, {
          topic,
          ...env.payload,
          at: env.ts,
        });
      } catch (err) {
        console.error("[fleet] bad status:", err);
      }
    },
    1,
  );

  await bus.subscribe(
    "mxpf/v1/agents/+/result/+",
    async (topic, payload) => {
      try {
        const env = parseEnvelope(payload);
        const resultPayload = {
          topic,
          jobId: env.id,
          ...env.payload,
          at: env.ts,
        };
        await recordAgentResult(env.agentId, resultPayload);
        settleWaiter(env.id, {
          jobId: env.id,
          ok: env.payload.ok === true,
          action: typeof env.payload.action === "string" ? env.payload.action : "",
          data: env.payload.data,
          error:
            typeof env.payload.error === "string" ? env.payload.error : undefined,
        });
        console.error(
          `[fleet] result ${env.agentId} job=${env.id} ok=${String(env.payload.ok)}`,
        );
      } catch (err) {
        console.error("[fleet] bad result:", err);
      }
    },
    1,
  );

  console.error("[fleet] bridge subscribed");

  const dispatchCmd = async (
    agentId: string,
    action: string,
    args: Record<string, unknown> = {},
  ): Promise<{ jobId: string }> => {
    const agent = await getAgent(agentId);
    if (!agent || agent.status !== "approved") {
      throw new Error(`agent not approved: ${agentId}`);
    }
    const jobId = crypto.randomUUID();
    const summary =
      action === "exec" && typeof args.cmd === "string"
        ? String(args.cmd).slice(0, 80)
        : action.startsWith("fs.")
          ? action
          : action === "host.profile" || action === "host"
            ? "host profile"
            : action === "self.update" || action === "update"
              ? "self update"
              : undefined;
    await setCurrentJob(agentId, { jobId, action, summary });
    const env = makeEnvelope("cmd.exec", agentId, { action, args }, jobId);
    await bus.publish(topics.cmd(agentId), serializeEnvelope(env), 1);
    return { jobId };
  };

  const dispatchCmdWait = async (
    agentId: string,
    action: string,
    args: Record<string, unknown> = {},
    timeoutMs = 15_000,
  ): Promise<FleetCmdResult> => {
    const { jobId } = await dispatchCmd(agentId, action, args);
    return new Promise<FleetCmdResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(jobId);
        reject(new Error(`fleet job timed out after ${timeoutMs}ms (${action})`));
      }, timeoutMs);
      waiters.set(jobId, { resolve, reject, timer });
    });
  };

  return {
    bus,
    listAgents: listFleetAgentsView,
    async approve(agentId, labels, caps) {
      const existing = await getAgent(agentId);
      let nextCaps = caps ?? existing?.caps ?? DEFAULT_APPROVE_CAPS;
      if (existing?.host && !nextCaps.includes("host")) {
        nextCaps = [...nextCaps, "host"];
      }
      if (!nextCaps.includes("update")) {
        nextCaps = [...nextCaps, "update"];
      }
      if (!nextCaps.includes("fs") && nextCaps.includes("exec")) {
        nextCaps = [...nextCaps, "fs"];
      }
      if (nextCaps.length === 0) {
        nextCaps = DEFAULT_APPROVE_CAPS;
      }
      const nextLabels = { ...(labels ?? existing?.labels ?? {}) };
      if (existing?.host?.purpose && !nextLabels.purpose) {
        nextLabels.purpose = existing.host.purpose
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 48);
      }
      const record = await approveAgent(agentId, nextLabels, nextCaps);
      const env = makeEnvelope("registry.approve", agentId, {
        approved: true,
        labels: record.labels,
        caps: record.caps,
      });
      await bus.publish(topics.approve(agentId), serializeEnvelope(env), 1);
      const all = await listAgents();
      await syncFleetMarkdown(all);
      console.error(`[fleet] approved ${agentId}`);
      return record;
    },
    dispatchCmd,
    dispatchCmdWait,
    async updateAgents(opts: FleetUpdateOptions = {}) {
      const { targets, missing } = await resolveUpdateTargets(opts);
      const jobs: FleetUpdateResult["jobs"] = [];

      for (const id of missing) {
        jobs.push({ agentId: id, error: "unknown agent" });
      }

      for (const agent of targets) {
        if (agent.status !== "approved") {
          jobs.push({
            agentId: agent.agentId,
            name: agent.name,
            error: `not approved (${agent.status})`,
          });
          continue;
        }
        try {
          const { action, args } = dispatchArgsForAgent(agent, opts);
          const { jobId } = await dispatchCmd(agent.agentId, action, args);
          jobs.push({
            agentId: agent.agentId,
            name: agent.name,
            jobId,
            action,
          });
        } catch (err) {
          jobs.push({
            agentId: agent.agentId,
            name: agent.name,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const started = jobs.filter((j) => j.jobId).length;
      const failed = jobs.filter((j) => j.error).length;
      return {
        ok: failed === 0 && started > 0,
        targeted: jobs.length,
        started,
        failed,
        jobs,
      };
    },
    async stop() {
      for (const [jobId, waiter] of waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("fleet bridge stopped"));
        waiters.delete(jobId);
      }
      await bus.end();
    },
  };
}
