import os from "node:os";

import { isWarm } from "../warmup.js";
import type { HeartbeatSnapshot } from "./types.js";

function mb(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

export function collectHeartbeatSnapshot(): HeartbeatSnapshot {
  const total = os.totalmem();
  const free = os.freemem();
  const usedPercent = Math.round(((total - free) / total) * 1000) / 10;
  const [one, five, fifteen] = os.loadavg();
  const mem = process.memoryUsage();
  const warnings: string[] = [];

  if (usedPercent >= 90) {
    warnings.push(`host memory ${usedPercent}% used`);
  } else if (usedPercent >= 80) {
    warnings.push(`host memory elevated (${usedPercent}%)`);
  }

  if (one > os.cpus().length * 1.5) {
    warnings.push(`load average high (${one.toFixed(2)} / ${os.cpus().length} cores)`);
  }

  if (!isWarm()) {
    warnings.push("agent not warm yet");
  }

  return {
    at: new Date().toISOString(),
    ok: warnings.length === 0,
    warm: isWarm(),
    memory: {
      totalMb: mb(total),
      freeMb: mb(free),
      usedPercent,
    },
    load: {
      one: Math.round(one * 100) / 100,
      five: Math.round(five * 100) / 100,
      fifteen: Math.round(fifteen * 100) / 100,
    },
    uptimeSec: Math.round(os.uptime()),
    process: {
      rssMb: mb(mem.rss),
      heapUsedMb: mb(mem.heapUsed),
    },
    warnings,
  };
}

export function logHeartbeat(snapshot: HeartbeatSnapshot): void {
  const warn = snapshot.warnings.length > 0 ? ` warnings=${snapshot.warnings.join("; ")}` : "";
  console.error(
    `[aria-heartbeat] ok=${snapshot.ok} mem=${snapshot.memory.usedPercent}% load=${snapshot.load.one}${warn}`,
  );
}
