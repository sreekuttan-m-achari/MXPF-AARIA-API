import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { agentCwd } from "../persona.js";
import {
  jobsFileSchema,
  parseDuration,
  type JobDefinition,
  type JobsFile,
} from "./types.js";

function envFlag(name: string, defaultOn = true): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return defaultOn;
  return raw !== "0" && raw !== "false" && raw !== "no" && raw !== "off";
}

export function schedulerEnabled(): boolean {
  return envFlag("AARIA_SCHEDULER", true);
}

export function jobsConfigPath(): string {
  const override = process.env.AARIA_JOBS_PATH?.trim();
  if (override) {
    return resolve(agentCwd(), override);
  }
  return resolve(agentCwd(), "jobs.json");
}

function defaultHeartbeatJob(): JobDefinition {
  const every = process.env.AARIA_HEARTBEAT_EVERY?.trim() || "5m";
  parseDuration(every);
  return {
    id: "heartbeat",
    type: "heartbeat",
    enabled: true,
    schedule: { every },
  };
}

export function loadJobsConfig(): JobsFile {
  const path = jobsConfigPath();
  if (existsSync(path)) {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return jobsFileSchema.parse(parsed);
  }

  if (!envFlag("AARIA_HEARTBEAT", true)) {
    return { jobs: [] };
  }

  return { jobs: [defaultHeartbeatJob()] };
}
