import type { FleetMqttConfig } from "./config.js";

/** Patterns the AARIA fleet bridge subscribes to (local view, not a broker catalog). */
export const FLEET_SUBSCRIPTION_PATTERNS = [
  "mxpf/v1/registry/announce",
  "mxpf/v1/registry/pending/+",
  "mxpf/v1/agents/+/status",
  "mxpf/v1/agents/+/result/+",
] as const;

export type FleetBusStats = {
  messagesIn: number;
  messagesOut: number;
  lastInAt?: string;
  lastOutAt?: string;
  lastTopic?: string;
  subscriptions: string[];
  connectedSince?: string;
};

export type FleetHubView = {
  provider: string;
  host: string;
  username: string;
  messagesIn: number;
  messagesOut: number;
  lastTrafficAt?: string;
  lastTopic?: string;
  subscriptions: string[];
  connectedSince?: string;
};

/** Strip credentials; keep host:port for Ops display. */
export function mqttHostFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.host || url;
  } catch {
    return url.replace(/^mqtts?:\/\//i, "").replace(/\/.*$/, "");
  }
}

export function emptyBusStats(): FleetBusStats {
  return {
    messagesIn: 0,
    messagesOut: 0,
    subscriptions: [],
  };
}

export function buildHubView(
  cfg: FleetMqttConfig,
  stats?: FleetBusStats | null,
): FleetHubView {
  const lastTrafficAt = pickLatest(stats?.lastInAt, stats?.lastOutAt);
  return {
    provider: cfg.provider,
    host: mqttHostFromUrl(cfg.url),
    username: cfg.username,
    messagesIn: stats?.messagesIn ?? 0,
    messagesOut: stats?.messagesOut ?? 0,
    lastTrafficAt,
    lastTopic: stats?.lastTopic,
    subscriptions:
      stats?.subscriptions?.length ?
        [...stats.subscriptions]
      : [...FLEET_SUBSCRIPTION_PATTERNS],
    connectedSince: stats?.connectedSince,
  };
}

function pickLatest(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}
