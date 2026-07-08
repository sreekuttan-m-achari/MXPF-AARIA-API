import { z } from "zod";

const durationPattern = /^(\d+)(ms|s|m|h|d)$/i;

export const scheduleSchema = z
  .object({
    every: z.string().regex(durationPattern, "use e.g. 30s, 5m, 1h, 1d").optional(),
    cron: z.string().min(1).optional(),
    timezone: z.string().min(1).optional(),
  })
  .refine((s) => Boolean(s.every) !== Boolean(s.cron), {
    message: "schedule must have exactly one of every or cron",
  });

export const heartbeatJobSchema = z.object({
  id: z.string().min(1),
  type: z.literal("heartbeat"),
  enabled: z.boolean().default(true),
  schedule: scheduleSchema,
});

export const promptJobSchema = z.object({
  id: z.string().min(1),
  type: z.literal("prompt"),
  enabled: z.boolean().default(true),
  schedule: scheduleSchema,
  message: z.string().min(1),
  skipIfBusy: z.boolean().default(true),
  learn: z.boolean().default(false),
});

export const jobSchema = z.discriminatedUnion("type", [
  heartbeatJobSchema,
  promptJobSchema,
]);

export const jobsFileSchema = z.object({
  jobs: z.array(jobSchema).default([]),
});

export type ScheduleSpec = z.infer<typeof scheduleSchema>;
export type JobDefinition = z.infer<typeof jobSchema>;
export type JobsFile = z.infer<typeof jobsFileSchema>;

export type JobRunStatus = "idle" | "running" | "ok" | "error" | "skipped";

export type JobState = {
  id: string;
  type: JobDefinition["type"];
  enabled: boolean;
  schedule: ScheduleSpec;
  status: JobRunStatus;
  lastRunAt?: string;
  lastOkAt?: string;
  lastError?: string;
  lastDurationMs?: number;
  runCount: number;
  nextRunAt?: string;
};

export type HeartbeatSnapshot = {
  at: string;
  ok: boolean;
  warm: boolean;
  memory: {
    totalMb: number;
    freeMb: number;
    usedPercent: number;
  };
  load: {
    one: number;
    five: number;
    fifteen: number;
  };
  uptimeSec: number;
  process: {
    rssMb: number;
    heapUsedMb: number;
  };
  warnings: string[];
};

export function parseDuration(value: string): number {
  const match = durationPattern.exec(value.trim());
  if (!match) {
    throw new Error(`invalid duration: ${value}`);
  }
  const amount = Number.parseInt(match[1]!, 10);
  const unit = match[2]!.toLowerCase();
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return amount * multipliers[unit]!;
}
