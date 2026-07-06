import { spawn } from "node:child_process";

import { apiBase } from "./config.js";

export type Health = {
  ok: boolean;
  name?: string;
  version?: string;
  warm?: boolean;
  greeting?: string;
  sessionId?: string;
  persona?: boolean;
  userProfile?: boolean;
  memory?: boolean;
  user?: string;
  learn?: { review: boolean };
  memoryStats?: { entries: number; chars: number; limit: number };
  mcp?: { loaded: boolean; servers: string[] };
};

export function systemdServiceName(): string {
  const name = process.env.AARIA_SYSTEMD_SERVICE?.trim();
  return name && name.length > 0 ? name : "aria-api.service";
}

export async function fetchHealth(): Promise<Health> {
  const res = await fetch(`${apiBase()}/health`, {
    signal: AbortSignal.timeout(3_000),
  });
  if (!res.ok) {
    throw new Error(`/health returned ${res.status}`);
  }
  return (await res.json()) as Health;
}

function startServerViaSystemd(): Promise<void> {
  const service = systemdServiceName();
  return new Promise((resolve, reject) => {
    const child = spawn("systemctl", ["--user", "start", service], {
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      reject(new Error(`failed to run systemctl: ${err.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = stderr.trim();
      reject(
        new Error(
          detail
            ? `systemctl --user start ${service}: ${detail}`
            : `systemctl --user start ${service} failed (exit ${code})`,
        ),
      );
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type EnsureOptions = {
  onStarting?: () => void;
  onWaiting?: () => void;
};

/** Ensure the ARIA API is up; starts the systemd user service once if needed. */
export async function ensureServerReady(
  options: EnsureOptions = {},
): Promise<{
  health: Health;
  startedService: boolean;
}> {
  try {
    const health = await fetchHealth();
    if (health.ok) {
      return { health, startedService: false };
    }
  } catch {
    // fall through to start + retry
  }

  options.onStarting?.();

  try {
    await startServerViaSystemd();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${msg}\n\nCould not reach ${apiBase()}. Is aria-api installed?\n  cd MXPF-AARIA-API && ./deploy/install-service.sh`,
    );
  }

  options.onWaiting?.();

  const delays = [500, 800, 1200, 1800, 2500, 3500, 5000, 7000, 10_000];
  for (const delay of delays) {
    await sleep(delay);
    try {
      const health = await fetchHealth();
      if (health.ok) {
        return { health, startedService: true };
      }
    } catch {
      // keep polling
    }
  }

  const health = await fetchHealth();
  return { health, startedService: true };
}
