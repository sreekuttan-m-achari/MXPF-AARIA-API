import type { AriaAgent } from "../agent.js";
import type { FleetBus } from "../fleet/bus.js";
import { loadConsoleConfig } from "./config.js";
import {
  startConsoleBridge,
  type ConsoleBridge,
} from "./bridge.js";

export { loadConsoleConfig } from "./config.js";
export { consoleTopics } from "./topics.js";
export type { ConsoleBridge } from "./bridge.js";
export type { ConsoleConfig } from "./config.js";
export type { ConsoleDevice } from "./device-store.js";
export type { PendingPair } from "./pairing.js";

let bridge: ConsoleBridge | null = null;

export function getConsoleBridge(): ConsoleBridge | null {
  return bridge;
}

export async function startConsole(
  bus: FleetBus,
  getAgent: () => AriaAgent,
): Promise<ConsoleBridge | null> {
  const cfg = loadConsoleConfig();
  if (!cfg) {
    console.error("[console] disabled (set AARIA_CONSOLE_ENABLED=1 and AARIA_CONSOLE_ID)");
    bridge = null;
    return null;
  }
  if (bridge) {
    try {
      await bridge.stop();
    } catch {
      /* ignore */
    }
    bridge = null;
  }
  bridge = await startConsoleBridge(bus, cfg, getAgent);
  return bridge;
}

export async function stopConsole(): Promise<void> {
  if (!bridge) return;
  try {
    await bridge.stop();
  } finally {
    bridge = null;
  }
}
