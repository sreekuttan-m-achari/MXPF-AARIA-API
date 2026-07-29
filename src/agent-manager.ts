import type { AriaAgent } from "./agent.js";
import { createAgent } from "./agent.js";
import { cancelStaleRuns } from "./agent-busy.js";
import { agentCwd } from "./persona.js";
import { clearPersistedAgentId } from "./session.js";
import { shutdownReviewAgent } from "./learn/review-agent.js";
import { resetWarmup, startWarmup } from "./warmup.js";

let agent: AriaAgent | undefined;

export async function initAgent(): Promise<AriaAgent> {
  agent = await createAgent();
  return agent;
}

export function getAgent(): AriaAgent {
  if (!agent) {
    throw new Error("agent not initialized");
  }
  return agent;
}

export async function resetAgentSession(): Promise<AriaAgent> {
  const cwd = agentCwd();
  if (agent) {
    try {
      await cancelStaleRuns(agent.agentId, cwd);
    } catch {
      /* best-effort */
    }
    try {
      await agent[Symbol.asyncDispose]();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[aria-agent] dispose before reset failed: ${msg}`);
    }
  }

  clearPersistedAgentId(cwd);
  resetWarmup();
  agent = await createAgent();
  const cleared = await cancelStaleRuns(agent.agentId, cwd);
  if (cleared > 0) {
    console.error(`[aria-agent] Cleared ${cleared} stale run(s) after session reset`);
  }
  startWarmup(agent);
  console.error(`[aria-agent] Reset session → ${agent.agentId}`);
  return agent;
}

export async function shutdownAgent(): Promise<void> {
  if (!agent) {
    await shutdownReviewAgent();
    return;
  }
  try {
    await agent[Symbol.asyncDispose]();
  } finally {
    agent = undefined;
    await shutdownReviewAgent();
  }
}
