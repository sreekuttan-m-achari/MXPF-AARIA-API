import type { AriaAgent } from "../agent.js";
import { enqueueAgentWork } from "../agent-queue.js";
import { handleChatTurn } from "../chat.js";
import { isChatCancelled } from "../errors.js";
import {
  makeEnvelope,
  serializeEnvelope,
  type FleetEnvelope,
} from "../fleet/envelope.js";
import type { FleetBus } from "../fleet/bus.js";
import { cancelActiveRun } from "../runs.js";
import { createChunkCoalescer } from "./chunk-coalesce.js";
import type { ConsoleConfig } from "./config.js";
import { getValidDeviceByToken } from "./device-store.js";
import { consoleTopics } from "./topics.js";

async function publishOut(
  bus: FleetBus,
  cfg: ConsoleConfig,
  msgId: string,
  type: string,
  payload: Record<string, unknown>,
  opts: { id?: string; qos?: 0 | 1 | 2 } = {},
): Promise<void> {
  const id = opts.id ?? msgId;
  const qos = opts.qos ?? 1;
  const env = makeEnvelope(type, cfg.ariaId, payload, id);
  await bus.publish(
    consoleTopics.webOut(cfg.ariaId, msgId),
    serializeEnvelope(env),
    qos,
  );
}

async function publishTyping(
  bus: FleetBus,
  cfg: ConsoleConfig,
  active: boolean,
): Promise<void> {
  const env = makeEnvelope("chat.typing", cfg.ariaId, { active });
  await bus.publish(
    consoleTopics.webTyping(cfg.ariaId),
    serializeEnvelope(env),
    1,
  );
}

export async function handleConsoleChatMessage(opts: {
  bus: FleetBus;
  cfg: ConsoleConfig;
  agent: AriaAgent;
  env: FleetEnvelope;
}): Promise<void> {
  const { bus, cfg, agent, env } = opts;
  const msgId = env.id;
  const message =
    typeof env.payload.message === "string" ? env.payload.message.trim() : "";
  const deviceToken =
    typeof env.payload.deviceToken === "string" ? env.payload.deviceToken : "";
  const targetAgentId =
    typeof env.payload.targetAgentId === "string"
      ? env.payload.targetAgentId.trim()
      : "";

  const device = await getValidDeviceByToken(cfg.storePath, deviceToken);
  if (!device) {
    await publishOut(bus, cfg, msgId, "chat.error", {
      code: "unauthorized",
      message: "Access denied — pairing may have expired",
    });
    return;
  }

  if (!message) {
    await publishOut(bus, cfg, msgId, "chat.error", {
      code: "invalid",
      message: "Empty message",
    });
    return;
  }

  // Receipts in parallel — don't serialize three broker RTTs before the agent.
  await Promise.all([
    publishOut(bus, cfg, msgId, "chat.delivered", {}),
    publishOut(bus, cfg, msgId, "chat.read", {}),
    publishTyping(bus, cfg, true),
  ]);

  const prompt = targetAgentId
    ? `[web console · prefer fleet targetAgentId=${targetAgentId} when relevant]\n\n${message}`
    : message;

  const chunks = createChunkCoalescer({
    maxWaitMs: 80,
    maxChars: 256,
    flush: (text) =>
      // QoS 0: high-frequency stream; chat.done (QoS 1) carries the full reply.
      publishOut(bus, cfg, msgId, "chat.chunk", { text }, { qos: 0 }),
  });

  try {
    const reply = await enqueueAgentWork(() =>
      handleChatTurn(
        agent,
        "console",
        msgId,
        prompt,
        (text) => {
          chunks.push(text);
        },
        true,
        { voice: false, learn: true },
      ),
    );
    await chunks.flush();
    // Always send full reply — QoS 0 chunks may be dropped; done is authoritative.
    await publishOut(bus, cfg, msgId, "chat.done", { reply });
  } catch (err) {
    await chunks.flush();
    if (isChatCancelled(err)) {
      await publishOut(bus, cfg, msgId, "chat.cancelled", {});
    } else {
      const messageText = err instanceof Error ? err.message : String(err);
      await publishOut(bus, cfg, msgId, "chat.error", {
        code: "agent_error",
        message: messageText,
      });
    }
  } finally {
    await publishTyping(bus, cfg, false);
  }
}

export async function handleConsoleChatCancel(opts: {
  bus: FleetBus;
  cfg: ConsoleConfig;
  env: FleetEnvelope;
}): Promise<void> {
  const { bus, cfg, env } = opts;
  const msgId = env.id;
  const deviceToken =
    typeof env.payload.deviceToken === "string" ? env.payload.deviceToken : "";
  const device = await getValidDeviceByToken(cfg.storePath, deviceToken);
  if (!device) {
    await publishOut(bus, cfg, msgId, "chat.error", {
      code: "unauthorized",
      message: "Access denied — pairing may have expired",
    });
    return;
  }
  await cancelActiveRun(msgId);
  await publishOut(bus, cfg, msgId, "chat.cancelled", {});
  await publishTyping(bus, cfg, false);
}
