import type { TokenUsage } from "@cursor/sdk";

export type RunOutcome = "finished" | "error" | "cancelled";

export type RunUsageRecord = {
  at: string;
  id: string;
  status: RunOutcome;
  model?: string;
  durationMs?: number;
  requestId?: string;
  usage?: TokenUsage;
};

export type UsageSnapshot = {
  since: string;
  runs: {
    total: number;
    finished: number;
    error: number;
    cancelled: number;
  };
  tokens: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
    reasoningTokens: number;
  };
  lastRun: RunUsageRecord | null;
  recent: RunUsageRecord[];
};

const RECENT_MAX = 12;
const startedAt = new Date().toISOString();

const totals = {
  finished: 0,
  error: 0,
  cancelled: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
  reasoningTokens: 0,
};

const recent: RunUsageRecord[] = [];
let lastRun: RunUsageRecord | null = null;

export function recordRunUsage(input: {
  id: string;
  status: RunOutcome;
  model?: string;
  durationMs?: number;
  requestId?: string;
  usage?: TokenUsage | null;
}): void {
  const usage = input.usage ?? undefined;
  const record: RunUsageRecord = {
    at: new Date().toISOString(),
    id: input.id,
    status: input.status,
    model: input.model,
    durationMs: input.durationMs,
    requestId: input.requestId,
    usage,
  };

  totals[input.status] += 1;
  if (usage) {
    totals.inputTokens += usage.inputTokens || 0;
    totals.outputTokens += usage.outputTokens || 0;
    totals.cacheReadTokens += usage.cacheReadTokens || 0;
    totals.cacheWriteTokens += usage.cacheWriteTokens || 0;
    totals.totalTokens += usage.totalTokens || 0;
    totals.reasoningTokens += usage.reasoningTokens || 0;
  }

  lastRun = record;
  recent.unshift(record);
  while (recent.length > RECENT_MAX) {
    recent.pop();
  }
}

export function getUsageSnapshot(): UsageSnapshot {
  return {
    since: startedAt,
    runs: {
      total: totals.finished + totals.error + totals.cancelled,
      finished: totals.finished,
      error: totals.error,
      cancelled: totals.cancelled,
    },
    tokens: {
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      cacheReadTokens: totals.cacheReadTokens,
      cacheWriteTokens: totals.cacheWriteTokens,
      totalTokens: totals.totalTokens,
      reasoningTokens: totals.reasoningTokens,
    },
    lastRun,
    recent: recent.slice(),
  };
}
