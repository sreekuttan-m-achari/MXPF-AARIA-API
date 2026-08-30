import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createChunkCoalescer } from "../console/chunk-coalesce.js";
import { loadConsoleConfig } from "../console/config.js";
import { consoleTopics } from "../console/topics.js";
import {
  clearDeviceTokenCache,
  getValidDeviceByToken,
  listDevices,
  newDeviceToken,
  purgeExpiredDevices,
  revokeAllDevices,
  revokeDevice,
  upsertDevice,
} from "../console/device-store.js";
import { createPairingRegistry } from "../console/pairing.js";
import { startConsoleBridge } from "../console/bridge.js";
import {
  makeEnvelope,
  parseEnvelope,
  serializeEnvelope,
} from "../fleet/envelope.js";
import type { FleetBus } from "../fleet/bus.js";
import type { AriaAgent } from "../agent.js";

test("console topics", () => {
  assert.equal(consoleTopics.announce, "mxpf/v1/aria/registry/announce");
  assert.equal(consoleTopics.status("desk-home"), "mxpf/v1/aria/desk-home/status");
  assert.equal(consoleTopics.webIn("desk-home"), "mxpf/v1/aria/desk-home/web/in");
  assert.equal(
    consoleTopics.webOut("desk-home", "m1"),
    "mxpf/v1/aria/desk-home/web/out/m1",
  );
});

test("chunk coalescer flushes by size and on final flush", async () => {
  const out: string[] = [];
  const c = createChunkCoalescer({
    maxWaitMs: 50,
    maxChars: 10,
    flush: async (text) => {
      out.push(text);
    },
  });
  c.push("hello "); // 6
  c.push("world!!"); // 7 → total 13 ≥ 10 → immediate flush of full buffer
  await c.flush();
  assert.deepEqual(out, ["hello world!!"]);
});

test("chunk coalescer timer batches small tokens", async () => {
  const out: string[] = [];
  const c = createChunkCoalescer({
    maxWaitMs: 30,
    maxChars: 1000,
    flush: async (text) => {
      out.push(text);
    },
  });
  c.push("a");
  c.push("b");
  c.push("c");
  assert.equal(out.length, 0);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(out, ["abc"]);
  await c.flush();
});

test("device token cache survives repeated lookups until revoke", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "aaria-console-cache-"));
  const storePath = path.join(dir, "devices.json");
  clearDeviceTokenCache();
  try {
    const now = new Date("2026-08-30T12:00:00.000Z");
    const device = await upsertDevice(storePath, {
      deviceId: "dev-cache",
      deviceToken: newDeviceToken(),
      label: "Phone",
      pairedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
    });
    assert.ok(await getValidDeviceByToken(storePath, device.deviceToken, now));
    assert.ok(await getValidDeviceByToken(storePath, device.deviceToken, now));
    await revokeDevice(storePath, "dev-cache");
    assert.equal(
      await getValidDeviceByToken(storePath, device.deviceToken, now),
      null,
    );
  } finally {
    clearDeviceTokenCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConsoleConfig disabled by default", () => {
  assert.equal(loadConsoleConfig({}), null);
  assert.equal(loadConsoleConfig({ AARIA_CONSOLE_ENABLED: "1" }), null);
});

test("loadConsoleConfig enabled", () => {
  const cfg = loadConsoleConfig({
    AARIA_CONSOLE_ENABLED: "1",
    AARIA_CONSOLE_ID: "desk-home",
    AARIA_CONSOLE_NAME: "Home",
    AARIA_CONSOLE_LABELS: "env=home,role=desk",
  });
  assert.ok(cfg);
  assert.equal(cfg.ariaId, "desk-home");
  assert.equal(cfg.name, "Home");
  assert.deepEqual(cfg.labels, { env: "home", role: "desk" });
});

test("device store round-trip + revoke + expiry", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "aaria-console-"));
  const storePath = path.join(dir, "devices.json");
  try {
    const now = new Date("2026-08-30T12:00:00.000Z");
    const device = await upsertDevice(storePath, {
      deviceId: "dev-1",
      deviceToken: newDeviceToken(),
      label: "Phone",
      pairedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    });
    assert.equal((await listDevices(storePath)).length, 1);
    assert.ok(await getValidDeviceByToken(storePath, device.deviceToken, now));
    assert.equal(
      await getValidDeviceByToken(
        storePath,
        device.deviceToken,
        new Date(now.getTime() + 120_000),
      ),
      null,
    );
    assert.equal(await revokeDevice(storePath, "dev-1"), true);
    assert.equal((await listDevices(storePath)).length, 0);

    await upsertDevice(storePath, {
      deviceId: "dev-2",
      deviceToken: "tok",
      label: "x",
      pairedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() - 1).toISOString(),
    });
    assert.equal(await purgeExpiredDevices(storePath, now), 1);
    assert.equal(await revokeAllDevices(storePath), 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("pairing approve/deny/expiry", () => {
  const reg = createPairingRegistry(60_000);
  const now = new Date("2026-08-30T12:00:00.000Z");
  const p = reg.register({
    deviceId: "d1",
    code: "472918",
    label: "Alice",
    now,
  });
  assert.equal(p.code, "472918");
  assert.equal(reg.list(now).length, 1);
  assert.ok(reg.get("472918", now));
  const taken = reg.take("472918", now);
  assert.ok(taken);
  assert.equal(reg.list(now).length, 0);

  reg.register({ deviceId: "d2", code: "111111", label: "B", now });
  assert.ok(reg.deny("111111", now));
  assert.equal(reg.list(now).length, 0);

  reg.register({
    deviceId: "d3",
    code: "222222",
    label: "C",
    now: new Date(now.getTime() - 120_000),
  });
  // TTL 60s — already expired relative to "now"
  assert.equal(reg.list(now).length, 0);
});

function createMockBus(): FleetBus & {
  published: Array<{ topic: string; payload: string }>;
  handlers: Map<string, Set<(t: string, p: Buffer) => void | Promise<void>>>;
} {
  const published: Array<{ topic: string; payload: string }> = [];
  const handlers = new Map<
    string,
    Set<(t: string, p: Buffer) => void | Promise<void>>
  >();
  return {
    published,
    handlers,
    async publish(topic, payload) {
      published.push({ topic, payload });
    },
    async subscribe(topic, handler) {
      let set = handlers.get(topic);
      if (!set) {
        set = new Set();
        handlers.set(topic, set);
      }
      set.add(handler);
    },
    async end() {},
    connected: () => true,
    stats: () => ({
      messagesIn: 0,
      messagesOut: published.length,
      subscriptions: [...handlers.keys()],
      connectedSince: new Date().toISOString(),
    }),
  };
}

test("console bridge announce + pair approve path", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "aaria-console-"));
  const storePath = path.join(dir, "devices.json");
  const bus = createMockBus();
  const fakeAgent = {} as AriaAgent;

  try {
    const bridge = await startConsoleBridge(
      bus,
      {
        ariaId: "desk-home",
        name: "Home",
        hostname: "host",
        labels: { env: "test" },
        version: "0.1.0",
        statusIntervalMs: 60_000,
        pairTtlMs: 300_000,
        deviceTtlMs: 86_400_000,
        storePath,
      },
      () => fakeAgent,
    );

    assert.ok(
      bus.published.some((p) => p.topic === consoleTopics.announce),
    );
    const announce = parseEnvelope(
      bus.published.find((p) => p.topic === consoleTopics.announce)!.payload,
    );
    assert.equal(announce.type, "aria.announce");
    assert.equal(announce.agentId, "desk-home");

    const inbox = consoleTopics.webIn("desk-home");
    const handlers = bus.handlers.get(inbox);
    assert.ok(handlers && handlers.size > 0);
    const handler = [...handlers!][0]!;

    const pairEnv = makeEnvelope("console.pair", "desk-home", {
      deviceId: "web-1",
      code: "654321",
      label: "Test Browser",
    });
    await handler(inbox, Buffer.from(serializeEnvelope(pairEnv)));
    assert.equal(bridge.listPending().length, 1);

    const device = await bridge.approvePair("654321");
    assert.equal(device.deviceId, "web-1");
    const pairedMsg = bus.published
      .map((p) => {
        try {
          return parseEnvelope(p.payload);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .find((e) => e!.type === "console.paired");
    assert.ok(pairedMsg);
    assert.equal(pairedMsg!.payload.deviceToken, device.deviceToken);

    // Unauthorized chat
    const chatEnv = makeEnvelope(
      "chat.message",
      "desk-home",
      { message: "hi", deviceToken: "bad", deviceId: "web-1" },
      "msg-1",
    );
    await handler(inbox, Buffer.from(serializeEnvelope(chatEnv)));
    const errMsg = bus.published
      .map((p) => {
        try {
          return parseEnvelope(p.payload);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .find((e) => e!.type === "chat.error" && e!.id === "msg-1");
    assert.ok(errMsg);
    assert.equal(errMsg!.payload.code, "unauthorized");

    await bridge.stop();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
