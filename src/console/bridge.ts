import type { AriaAgent } from "../agent.js";
import type { FleetBus } from "../fleet/bus.js";
import {
  makeEnvelope,
  parseEnvelope,
  serializeEnvelope,
} from "../fleet/envelope.js";
import type { ConsoleConfig } from "./config.js";
import {
  handleConsoleChatCancel,
  handleConsoleChatMessage,
} from "./chat-handler.js";
import {
  listDevices,
  newDeviceToken,
  purgeExpiredDevices,
  revokeAllDevices,
  revokeDevice,
  upsertDevice,
  type ConsoleDevice,
} from "./device-store.js";
import {
  createPairingRegistry,
  type PendingPair,
  type PairingRegistry,
} from "./pairing.js";
import { consoleTopics } from "./topics.js";

export type ConsoleBridge = {
  cfg: ConsoleConfig;
  stop: () => Promise<void>;
  listPending: () => PendingPair[];
  listDevices: () => Promise<ConsoleDevice[]>;
  approvePair: (code: string) => Promise<ConsoleDevice>;
  denyPair: (code: string) => Promise<PendingPair | null>;
  revoke: (deviceId: string) => Promise<boolean>;
  revokeAll: () => Promise<number>;
  status: () => {
    ariaId: string;
    name: string;
    pending: number;
  };
  republish: () => Promise<void>;
};

export async function startConsoleBridge(
  bus: FleetBus,
  cfg: ConsoleConfig,
  getAgent: () => AriaAgent,
): Promise<ConsoleBridge> {
  const pairing: PairingRegistry = createPairingRegistry(cfg.pairTtlMs);
  let typing = false;
  let stopped = false;

  async function publishAnnounce(): Promise<void> {
    const env = makeEnvelope("aria.announce", cfg.ariaId, {
      name: cfg.name,
      hostname: cfg.hostname,
      labels: cfg.labels,
      version: cfg.version,
    });
    // retain so browsers that connect later still see this desk
    await bus.publish(consoleTopics.announce, serializeEnvelope(env), 1, true);
    console.error(`[console] published announce → ${consoleTopics.announce}`);
  }

  async function publishStatus(): Promise<void> {
    const env = makeEnvelope("aria.status", cfg.ariaId, {
      name: cfg.name,
      lastSeenAt: new Date().toISOString(),
      warm: true,
      typing,
    });
    await bus.publish(
      consoleTopics.status(cfg.ariaId),
      serializeEnvelope(env),
      1,
      true,
    );
  }

  async function publishPresence(): Promise<void> {
    await publishAnnounce();
    await publishStatus();
  }

  async function handleInbox(topic: string, payload: Buffer): Promise<void> {
    if (stopped) return;
    let env;
    try {
      env = parseEnvelope(payload);
    } catch (err) {
      console.error("[console] bad envelope on", topic, err);
      return;
    }
    if (env.agentId !== cfg.ariaId) return;

    if (env.type === "console.pair") {
      const deviceId =
        typeof env.payload.deviceId === "string" ? env.payload.deviceId : "";
      const code = typeof env.payload.code === "string" ? env.payload.code : "";
      const label =
        typeof env.payload.label === "string" ? env.payload.label : "Web console";
      try {
        const pending = pairing.register({ deviceId, code, label });
        console.error(
          `[console] pairing request code=${pending.code} device=${pending.deviceId} label=${pending.label}`,
        );
        console.error(
          `[console] approve with: /console pair ${pending.code}`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const out = makeEnvelope(
          "console.denied",
          cfg.ariaId,
          { deviceId, reason: message },
          env.id,
        );
        await bus.publish(
          consoleTopics.webOut(cfg.ariaId, env.id),
          serializeEnvelope(out),
          1,
        );
      }
      return;
    }

    if (env.type === "chat.message") {
      typing = true;
      try {
        await handleConsoleChatMessage({
          bus,
          cfg,
          agent: getAgent(),
          env,
        });
      } finally {
        typing = false;
      }
      return;
    }

    if (env.type === "chat.cancel") {
      await handleConsoleChatCancel({ bus, cfg, env });
      return;
    }
  }

  await purgeExpiredDevices(cfg.storePath);
  await bus.subscribe(consoleTopics.webIn(cfg.ariaId), handleInbox, 1);
  try {
    await publishPresence();
  } catch (err) {
    console.error(
      "[console] initial announce/status FAILED — check HiveMQ ACL for mxpf/v1/aria/# publish:",
      err,
    );
  }

  const timer = setInterval(() => {
    void publishPresence().catch((err) => {
      console.error("[console] presence publish failed (ACL?):", err);
    });
  }, cfg.statusIntervalMs);
  if (typeof timer.unref === "function") timer.unref();

  console.error(`[console] enabled ariaId=${cfg.ariaId} name=${cfg.name}`);

  return {
    cfg,
    async stop() {
      stopped = true;
      clearInterval(timer);
      pairing.clear();
    },
    listPending: () => pairing.list(),
    listDevices: () => listDevices(cfg.storePath),
    async approvePair(code: string) {
      const pending = pairing.take(code);
      if (!pending) {
        throw new Error(`no pending pair for code ${code}`);
      }
      const now = new Date();
      const device: ConsoleDevice = {
        deviceId: pending.deviceId,
        deviceToken: newDeviceToken(),
        label: pending.label,
        pairedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + cfg.deviceTtlMs).toISOString(),
      };
      await upsertDevice(cfg.storePath, device);
      const out = makeEnvelope("console.paired", cfg.ariaId, {
        deviceId: device.deviceId,
        deviceToken: device.deviceToken,
        expiresAt: device.expiresAt,
        label: device.label,
      });
      await bus.publish(
        consoleTopics.webOut(cfg.ariaId, device.deviceId),
        serializeEnvelope(out),
        1,
      );
      console.error(
        `[console] paired device=${device.deviceId} label=${device.label}`,
      );
      return device;
    },
    async denyPair(code: string) {
      const pending = pairing.deny(code);
      if (!pending) return null;
      const out = makeEnvelope("console.denied", cfg.ariaId, {
        deviceId: pending.deviceId,
        reason: "denied by operator",
      });
      await bus.publish(
        consoleTopics.webOut(cfg.ariaId, pending.deviceId),
        serializeEnvelope(out),
        1,
      );
      return pending;
    },
    revoke: (deviceId: string) => revokeDevice(cfg.storePath, deviceId),
    revokeAll: () => revokeAllDevices(cfg.storePath),
    status: () => ({
      ariaId: cfg.ariaId,
      name: cfg.name,
      pending: pairing.list().length,
    }),
    republish: () => publishPresence(),
  };
}
