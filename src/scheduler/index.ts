import cron from "node-cron";

import type { AriaAgent } from "../agent.js";
import { jobsConfigPath, loadJobsConfig, schedulerEnabled } from "./config.js";
import { runJob, type JobRunResult } from "./runner.js";
import {
  parseDuration,
  type HeartbeatSnapshot,
  type JobDefinition,
  type JobRunStatus,
  type JobState,
  type ScheduleSpec,
} from "./types.js";

type ScheduledHandle = {
  stop: () => void;
  updateNextRun: () => void;
};

let agentRef: AriaAgent | undefined;
let jobs = new Map<string, JobDefinition>();
let states = new Map<string, JobState>();
let handles = new Map<string, ScheduledHandle>();
let lastHeartbeat: HeartbeatSnapshot | undefined;
let started = false;

function jobState(job: JobDefinition): JobState {
  const existing = states.get(job.id);
  if (existing) {
    existing.type = job.type;
    existing.enabled = job.enabled;
    existing.schedule = job.schedule;
    return existing;
  }
  const state: JobState = {
    id: job.id,
    type: job.type,
    enabled: job.enabled,
    schedule: job.schedule,
    status: "idle",
    runCount: 0,
  };
  states.set(job.id, state);
  return state;
}

function computeNextRun(spec: ScheduleSpec): string | undefined {
  if (spec.every) {
    const ms = parseDuration(spec.every);
    return new Date(Date.now() + ms).toISOString();
  }
  return undefined;
}

async function executeJob(
  job: JobDefinition,
  reason: "schedule" | "manual",
): Promise<JobRunResult | undefined> {
  if (!agentRef) return undefined;
  const state = jobState(job);
  if (!job.enabled) {
    state.status = "skipped";
    state.lastError = "disabled";
    return { ok: false, error: "disabled", skipped: true };
  }

  state.status = "running";
  const startedAt = Date.now();
  const result = await runJob(agentRef, job, reason);
  state.lastRunAt = new Date().toISOString();
  state.lastDurationMs = Date.now() - startedAt;
  state.runCount += 1;

  if (result.ok) {
    state.status = "ok";
    state.lastOkAt = state.lastRunAt;
    state.lastError = undefined;
    if (result.kind === "heartbeat") {
      lastHeartbeat = result.snapshot;
    }
  } else if (result.skipped) {
    state.status = "skipped";
    state.lastError = result.error;
  } else {
    state.status = "error";
    state.lastError = result.error;
  }

  return result;
}

function scheduleIntervalJob(job: JobDefinition): ScheduledHandle {
  const ms = parseDuration(job.schedule.every!);
  let timer: NodeJS.Timeout | undefined;
  let nextRunAt = computeNextRun(job.schedule);

  const state = jobState(job);
  state.nextRunAt = nextRunAt;

  const tick = (): void => {
    void executeJob(job, "schedule").finally(() => {
      nextRunAt = computeNextRun(job.schedule);
      state.nextRunAt = nextRunAt;
      timer = setTimeout(tick, ms);
    });
  };

  timer = setTimeout(tick, ms);

  return {
    stop: () => {
      if (timer) clearTimeout(timer);
    },
    updateNextRun: () => {
      state.nextRunAt = nextRunAt;
    },
  };
}

function scheduleCronJob(job: JobDefinition): ScheduledHandle {
  const expression = job.schedule.cron!;
  const timezone = job.schedule.timezone;
  const valid = cron.validate(expression);
  if (!valid) {
    throw new Error(`invalid cron for job ${job.id}: ${expression}`);
  }

  const state = jobState(job);
  const task = cron.schedule(
    expression,
    () => {
      void executeJob(job, "schedule");
    },
    {
      timezone,
    },
  );

  return {
    stop: () => task.stop(),
    updateNextRun: () => {
      state.nextRunAt = undefined;
    },
  };
}

function mountJob(job: JobDefinition): void {
  const handle =
    job.schedule.every !== undefined
      ? scheduleIntervalJob(job)
      : scheduleCronJob(job);
  handles.set(job.id, handle);
}

function clearSchedules(): void {
  for (const handle of handles.values()) {
    handle.stop();
  }
  handles.clear();
}

function applyConfig(): void {
  clearSchedules();
  jobs.clear();

  const config = loadJobsConfig();
  for (const job of config.jobs) {
    jobs.set(job.id, job);
    jobState(job);
    if (job.enabled) {
      mountJob(job);
    }
  }

  console.error(
    `[aria-jobs] loaded ${config.jobs.length} job(s) from ${jobsConfigPath()} (${config.jobs.filter((j) => j.enabled).length} enabled)`,
  );
}

export function startScheduler(agent: AriaAgent): void {
  if (!schedulerEnabled()) {
    console.error("[aria-jobs] scheduler disabled (AARIA_SCHEDULER=0)");
    return;
  }
  if (started) return;

  agentRef = agent;
  started = true;
  applyConfig();
}

export function stopScheduler(): void {
  clearSchedules();
  started = false;
  agentRef = undefined;
}

export function reloadScheduler(): { ok: true; count: number } | { ok: false; error: string } {
  if (!started) {
    return { ok: false, error: "scheduler not started" };
  }
  try {
    applyConfig();
    return { ok: true, count: jobs.size };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[aria-jobs] reload failed: ${error}`);
    return { ok: false, error };
  }
}

export function listJobStates(): JobState[] {
  return [...jobs.values()].map((job) => {
    const state = jobState(job);
    return { ...state };
  });
}

export function getLastHeartbeat(): HeartbeatSnapshot | undefined {
  return lastHeartbeat;
}

export function schedulerStatus(): {
  enabled: boolean;
  started: boolean;
  configPath: string;
  jobCount: number;
  lastHeartbeat?: HeartbeatSnapshot;
} {
  return {
    enabled: schedulerEnabled(),
    started,
    configPath: jobsConfigPath(),
    jobCount: jobs.size,
    lastHeartbeat,
  };
}

export async function triggerJob(
  id: string,
): Promise<
  | { ok: true; result: JobRunResult }
  | { ok: false; error: string; status?: JobRunStatus }
> {
  const job = jobs.get(id);
  if (!job) {
    return { ok: false, error: `unknown job ${id}` };
  }
  if (!agentRef) {
    return { ok: false, error: "scheduler not started" };
  }
  const result = await executeJob(job, "manual");
  if (!result) {
    return { ok: false, error: "job did not run" };
  }
  return { ok: true, result };
}
