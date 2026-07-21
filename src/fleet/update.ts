import { getAgent, listAgents, type AgentRecord } from "./registry-store.js";

export type FleetUpdateOptions = {
  /** Explicit agent IDs, or omit / `"all"` for every approved minion. */
  agentIds?: string[] | "all";
  refreshHost?: boolean;
  reinstall?: boolean;
  skipPull?: boolean;
};

export type FleetUpdateJob = {
  agentId: string;
  name?: string;
  jobId?: string;
  action?: "self.update" | "exec";
  error?: string;
};

export type FleetUpdateResult = {
  ok: boolean;
  targeted: number;
  started: number;
  failed: number;
  jobs: FleetUpdateJob[];
};

function buildUpdateArgs(opts: FleetUpdateOptions): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  if (opts.refreshHost) args.refreshHost = true;
  if (opts.reinstall) args.reinstall = true;
  if (opts.skipPull) args.skipPull = true;
  return args;
}

/** Fallback for minions that do not yet advertise the `update` cap. */
export function buildExecUpgradeCmd(opts: FleetUpdateOptions): string {
  const flags = ["--yes"];
  if (opts.reinstall) flags.push("--reinstall");
  if (opts.refreshHost) flags.push("--refresh-host");
  if (opts.skipPull) flags.push("--skip-pull");
  return [
    `LOG=/tmp/astra-upgrade-$$.log; nohup bash deploy/install-upgrade.sh ${flags.join(" ")} >"$LOG" 2>&1 &`,
    `echo "started pid=$! log=$LOG"`,
  ].join(" ");
}

export async function resolveUpdateTargets(
  opts: FleetUpdateOptions,
): Promise<{ targets: AgentRecord[]; missing: string[] }> {
  const all = await listAgents();
  const approved = all.filter((a) => a.status === "approved");

  if (!opts.agentIds || opts.agentIds === "all") {
    return { targets: approved, missing: [] };
  }

  const wanted = [
    ...new Set(opts.agentIds.map((id) => id.trim()).filter(Boolean)),
  ];
  const targets: AgentRecord[] = [];
  const missing: string[] = [];

  for (const id of wanted) {
    const agent = await getAgent(id);
    if (!agent) {
      missing.push(id);
      continue;
    }
    targets.push(agent);
  }

  return { targets, missing };
}

export function chooseUpdateAction(agent: AgentRecord): "self.update" | "exec" {
  if (agent.caps.includes("update") || agent.caps.includes("self.update")) {
    return "self.update";
  }
  return "exec";
}

export function dispatchArgsForAgent(
  agent: AgentRecord,
  opts: FleetUpdateOptions,
): { action: "self.update" | "exec"; args: Record<string, unknown> } {
  const action = chooseUpdateAction(agent);
  if (action === "self.update") {
    return { action, args: buildUpdateArgs(opts) };
  }
  return {
    action: "exec",
    args: { cmd: buildExecUpgradeCmd(opts) },
  };
}
