import { createFleetBus, type FleetBus } from "./bus.js";
import { loadFleetMqttConfig } from "./config.js";
import {
  listFleetAgentsView,
  startFleetBridge,
  type FleetBridge,
} from "./bridge.js";

export { listFleetAgentsView } from "./bridge.js";

let bridge: FleetBridge | null = null;
let enabled = false;
let connected = false;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

export function fleetStatus(): { enabled: boolean; connected: boolean } {
  return {
    enabled,
    connected: connected && (bridge?.bus.connected() ?? false),
  };
}

export function getFleetBridge(): FleetBridge | null {
  return bridge;
}

async function connectOnce(): Promise<boolean> {
  const cfg = loadFleetMqttConfig();
  if (!cfg) {
    enabled = false;
    connected = false;
    bridge = null;
    return false;
  }
  enabled = true;
  const bus: FleetBus = await createFleetBus(cfg);
  bridge = await startFleetBridge(bus);
  connected = true;
  console.error(`[fleet] connected via ${cfg.provider}`);
  return true;
}

function scheduleReconnect(delayMs = 10_000): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    void startFleet();
  }, delayMs);
  if (typeof reconnectTimer.unref === "function") reconnectTimer.unref();
}

export async function startFleet(): Promise<void> {
  const cfg = loadFleetMqttConfig();
  if (!cfg) {
    console.error("[fleet] disabled (no AARIA_MQTT_URL)");
    enabled = false;
    connected = false;
    bridge = null;
    return;
  }
  enabled = true;
  try {
    if (bridge) {
      try {
        await bridge.stop();
      } catch {
        /* ignore */
      }
      bridge = null;
      connected = false;
    }
    await connectOnce();
  } catch (err) {
    connected = false;
    bridge = null;
    console.error("[fleet] failed to connect:", err);
    console.error("[fleet] retrying in 10s…");
    scheduleReconnect(10_000);
  }
}

export async function stopFleet(): Promise<void> {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }
  if (bridge) {
    await bridge.stop();
    bridge = null;
  }
  connected = false;
}

export async function listAgentsForApi() {
  if (bridge) return bridge.listAgents();
  return listFleetAgentsView();
}
