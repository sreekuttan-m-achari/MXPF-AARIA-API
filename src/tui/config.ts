export function apiBase(): string {
  const override = process.env.AARIA_API_URL?.trim();
  if (override) {
    return override.replace(/\/$/, "");
  }
  const host = process.env.AARIA_WS_HOST?.trim() || "127.0.0.1";
  const raw = process.env.AARIA_WS_PORT?.trim() || "8788";
  const port = Number.parseInt(raw, 10);
  const safePort =
    Number.isFinite(port) && port > 0 && port < 65536 ? port : 8788;
  return `http://${host}:${safePort}`;
}

export function wsUrl(): string {
  const base = apiBase();
  if (base.startsWith("https://")) {
    return `wss://${base.slice(8)}`;
  }
  if (base.startsWith("http://")) {
    return `ws://${base.slice(7)}`;
  }
  return `ws://${base}`;
}
