import { hostname as osHostname } from "node:os";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type ConsoleConfig = {
  ariaId: string;
  name: string;
  hostname: string;
  labels: Record<string, string>;
  version: string;
  statusIntervalMs: number;
  pairTtlMs: number;
  deviceTtlMs: number;
  storePath: string;
};

function truthy(v: string | undefined): boolean {
  const t = v?.trim().toLowerCase();
  return t === "1" || t === "true" || t === "yes" || t === "on";
}

function parseLabels(raw: string | undefined): Record<string, string> {
  if (!raw?.trim()) return {};
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed) as unknown;
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          if (typeof v === "string") out[k] = v;
          else if (v != null) out[k] = String(v);
        }
        return out;
      }
    } catch {
      /* fall through to k=v */
    }
  }
  const out: Record<string, string> = {};
  for (const part of trimmed.split(",")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

function packageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(here, "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    return pkg.version?.trim() || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function parseMs(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Returns null when console MQTT is disabled or ariaId is missing. */
export function loadConsoleConfig(
  source: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): ConsoleConfig | null {
  if (!truthy(source.AARIA_CONSOLE_ENABLED)) return null;
  const ariaId = source.AARIA_CONSOLE_ID?.trim();
  if (!ariaId) return null;

  const name =
    source.AARIA_CONSOLE_NAME?.trim() || `AARIA · ${ariaId}`;
  const storeOverride = source.AARIA_CONSOLE_STORE?.trim();
  const storePath = storeOverride
    ? storeOverride.startsWith("/")
      ? storeOverride
      : join(cwd, storeOverride)
    : join(cwd, ".aaria", "console-devices.json");

  return {
    ariaId,
    name,
    hostname: osHostname(),
    labels: parseLabels(source.AARIA_CONSOLE_LABELS),
    version: packageVersion(),
    statusIntervalMs: parseMs(source.AARIA_CONSOLE_STATUS_INTERVAL_MS, 30_000),
    pairTtlMs: parseMs(source.AARIA_CONSOLE_PAIR_TTL_MS, 300_000),
    deviceTtlMs: parseMs(source.AARIA_CONSOLE_DEVICE_TTL_MS, 2_592_000_000),
    storePath,
  };
}
