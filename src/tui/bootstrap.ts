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
  context?: {
    window: {
      usedTokens: number | null;
      limitTokens: number;
      percent: number | null;
      model?: string;
    };
    prompts: {
      soulChars: number;
      userChars: number;
      userLearnedChars: number;
      userLearnedLimit: number;
      memoryChars: number;
      memoryLimit: number;
      memoryEntries: number;
      fleetChars: number;
      standingChars: number;
    };
  };
  voice?: { enabled: boolean; engine: string; source: string };
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

export type SessionResetResult = {
  ok: boolean;
  previousSessionId?: string;
  sessionId?: string;
  warm?: boolean;
  greeting?: string;
  error?: string;
};

/** Dispose the stuck Cursor session and create a fresh one (server-side). */
export async function resetSession(): Promise<SessionResetResult> {
  const res = await fetch(`${apiBase()}/session/reset`, {
    method: "POST",
    signal: AbortSignal.timeout(90_000),
  });
  const body = (await res.json()) as SessionResetResult;
  if (!res.ok || !body.ok) {
    throw new Error(body.error ?? `/session/reset returned ${res.status}`);
  }
  return body;
}

export type VoiceStatusResult = {
  ok: boolean;
  enabled: boolean;
  engine: string;
  source: string;
  error?: string;
};

export async function fetchVoiceStatus(): Promise<VoiceStatusResult> {
  const res = await fetch(`${apiBase()}/voice`, {
    signal: AbortSignal.timeout(5_000),
  });
  const body = (await res.json()) as VoiceStatusResult;
  if (!res.ok || body.error) {
    throw new Error(body.error ?? `/voice returned ${res.status}`);
  }
  return body;
}

export async function setVoiceMode(
  action: "on" | "off" | "toggle",
): Promise<VoiceStatusResult> {
  const res = await fetch(`${apiBase()}/voice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json()) as VoiceStatusResult;
  if (!res.ok || body.error) {
    throw new Error(body.error ?? `/voice returned ${res.status}`);
  }
  return body;
}

/** Speak text on the API host (fire-and-forget from the TUI). */
export async function speakOnServer(
  text: string,
  kind: "greeting" | "raw" = "raw",
): Promise<boolean> {
  try {
    const res = await fetch(`${apiBase()}/voice/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, kind }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { spoken?: boolean };
    return Boolean(body.spoken);
  } catch {
    return false;
  }
}

/** Pre-warm Piper on the API host so first spoken reply has low latency. */
export async function warmVoiceEngine(): Promise<{
  ok: boolean;
  engine?: string;
  ms?: number;
  skipped?: boolean;
}> {
  try {
    const res = await fetch(`${apiBase()}/voice/warmup`, {
      method: "POST",
      signal: AbortSignal.timeout(50_000),
    });
    if (!res.ok) {
      return { ok: false };
    }
    return (await res.json()) as {
      ok: boolean;
      engine?: string;
      ms?: number;
      skipped?: boolean;
    };
  } catch {
    return { ok: false };
  }
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
