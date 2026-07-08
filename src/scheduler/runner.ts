import type { AriaAgent } from "../agent.js";
import { enqueueAgentWork, isAgentQueueIdle } from "../agent-queue.js";
import { handleChatTurn } from "../chat.js";
import { collectHeartbeatSnapshot, logHeartbeat } from "./heartbeat.js";
import type { HeartbeatSnapshot, JobDefinition } from "./types.js";

export type JobRunResult =
  | { ok: true; kind: "heartbeat"; snapshot: HeartbeatSnapshot }
  | { ok: true; kind: "prompt"; reply: string }
  | { ok: false; error: string; skipped?: boolean };

export async function runJob(
  agent: AriaAgent,
  job: JobDefinition,
  reason: "schedule" | "manual" = "schedule",
): Promise<JobRunResult> {
  if (job.type === "heartbeat") {
    const snapshot = collectHeartbeatSnapshot();
    logHeartbeat(snapshot);
    if (reason === "manual") {
      console.error("[aria-jobs] manual heartbeat run");
    }
    return { ok: true, kind: "heartbeat", snapshot };
  }

  if (job.skipIfBusy && !isAgentQueueIdle()) {
    return { ok: false, error: "agent busy", skipped: true };
  }

  const id = `job:${job.id}:${Date.now()}`;
  try {
    const reply = await enqueueAgentWork(() =>
      handleChatTurn(agent, "job", id, job.message, undefined, true, {
        learn: job.learn,
      }),
    );
    console.error(
      `[aria-jobs] prompt ${job.id} done (${reply.length} chars) reason=${reason}`,
    );
    return { ok: true, kind: "prompt", reply };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[aria-jobs] prompt ${job.id} failed: ${error}`);
    return { ok: false, error };
  }
}
