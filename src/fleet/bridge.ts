import {
  makeEnvelope,
  parseEnvelope,
  serializeEnvelope,
} from "./envelope.js";
import { syncFleetMarkdown } from "./fleet-md.js";
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
import { currentTaskLabel, fleetPresence } from "./presence.js";
import { topics } from "./topics.js";
import type { FleetBus } from "./bus.js";

export type FleetAgentView = AgentRecord & {
  presence: ReturnType<typeof fleetPresence>;
  task: string;
};

export function toFleetAgentView(agent: AgentRecord): FleetAgentView {
  return {
    ...agent,
    presence: fleetPresence(agent.status, agent.lastSeenAt),
    task: currentTaskLabel(agent),
  };
}

export async function listFleetAgentsView(): Promise<FleetAgentView[]> {
  const agents = await listAgents();
  return agents.map(toFleetAgentView);
}

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
  stop: () => Promise<void>;
};

export async function startFleetBridge(bus: FleetBus): Promise<FleetBridge> {
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
      await upsertPending({
        agentId: env.agentId,
        name,
        hostname,
        labels,
        caps,
      });
      console.error(`[fleet] pending announce from ${env.agentId}`);
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
        await recordAgentResult(env.agentId, {
          topic,
          jobId: env.id,
          ...env.payload,
          at: env.ts,
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

  return {
    bus,
    listAgents: listFleetAgentsView,
    async approve(agentId, labels, caps) {
      const record = await approveAgent(
        agentId,
        labels,
        caps ?? ["health", "exec"],
      );
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
    async dispatchCmd(agentId, action, args = {}) {
      const agent = await getAgent(agentId);
      if (!agent || agent.status !== "approved") {
        throw new Error(`agent not approved: ${agentId}`);
      }
      const jobId = crypto.randomUUID();
      const summary =
        action === "exec" && typeof args.cmd === "string"
          ? String(args.cmd).slice(0, 80)
          : undefined;
      await setCurrentJob(agentId, { jobId, action, summary });
      const env = makeEnvelope(
        "cmd.exec",
        agentId,
        { action, args },
        jobId,
      );
      await bus.publish(topics.cmd(agentId), serializeEnvelope(env), 1);
      return { jobId };
    },
    async stop() {
      await bus.end();
    },
  };
}
