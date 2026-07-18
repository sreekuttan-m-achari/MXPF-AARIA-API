import { createFleetBus, type FleetBus } from "./bus.js";
import { loadFleetMqttConfig } from "./config.js";
import { startFleetBridge, type FleetBridge } from "./bridge.js";

let bridge: FleetBridge | null = null;
let enabled = false;
let connected = false;

export function fleetStatus(): { enabled: boolean; connected: boolean } {
  return {
    enabled,
    connected: connected && (bridge?.bus.connected() ?? false),
  };
}

export function getFleetBridge(): FleetBridge | null {
  return bridge;
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
    const bus: FleetBus = await createFleetBus(cfg);
    bridge = await startFleetBridge(bus);
    connected = true;
    console.error(`[fleet] connected via ${cfg.provider}`);
  } catch (err) {
    connected = false;
    bridge = null;
    console.error("[fleet] failed to connect:", err);
  }
}

export async function stopFleet(): Promise<void> {
  if (bridge) {
    await bridge.stop();
    bridge = null;
  }
  connected = false;
}
