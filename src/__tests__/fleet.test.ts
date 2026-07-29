import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { loadFleetMqttConfig } from "../fleet/config.js";
import { parseEnvelope, serializeEnvelope } from "../fleet/envelope.js";
import { renderFleetTable, syncFleetMarkdown } from "../fleet/fleet-md.js";
import {
  approveAgent,
  listAgents,
  upsertPending,
} from "../fleet/registry-store.js";
import { topics } from "../fleet/topics.js";

test("fleet envelope round-trip", () => {
  const env = {
    v: 1 as const,
    type: "cmd.exec",
    id: "j1",
    ts: "2026-07-18T00:00:00.000Z",
    agentId: "astra-demo",
    payload: { action: "health", args: {} },
  };
  assert.deepEqual(parseEnvelope(serializeEnvelope(env)), env);
});

test("fleet topics", () => {
  assert.equal(topics.cmd("astra-demo"), "mxpf/v1/agents/astra-demo/cmd");
});

test("loadFleetMqttConfig null without url", () => {
  assert.equal(loadFleetMqttConfig({}), null);
});

test("loadFleetMqttConfig parses password with hash", () => {
  const cfg = loadFleetMqttConfig({
    AARIA_MQTT_URL: "mqtts://example.hivemq.cloud:8883",
    AARIA_MQTT_USERNAME: "mxpfaaria",
    AARIA_MQTT_PASSWORD: "#secret",
  });
  assert.ok(cfg);
  assert.equal(cfg!.password, "#secret");
});

test("fleet hub view strips host and tracks defaults", async () => {
  const { buildHubView, mqttHostFromUrl } = await import("../fleet/hub.js");
  assert.equal(
    mqttHostFromUrl("mqtts://user:pass@broker.example:8883/path"),
    "broker.example:8883",
  );
  const hub = buildHubView({
    provider: "hivemq",
    url: "mqtts://d5.example.hivemq.cloud:8883",
    username: "mxpfaaria",
    password: "x",
  });
  assert.equal(hub.host, "d5.example.hivemq.cloud:8883");
  assert.equal(hub.messagesIn, 0);
  assert.ok(hub.subscriptions.includes("mxpf/v1/agents/+/status"));
});

test("registry approve + fleet markdown", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fleet-"));
  try {
    await upsertPending(
      {
        agentId: "astra-demo",
        name: "demo",
        hostname: "host1",
        caps: ["health", "exec"],
      },
      dir,
    );
    await approveAgent("astra-demo", { env: "lab" }, ["health", "exec"], dir);
    const agents = await listAgents(dir);
    assert.equal(agents[0]!.status, "approved");
    const table = renderFleetTable(agents);
    assert.match(table, /astra-demo/);
    assert.match(table, /FLEET:BEGIN/);
    await syncFleetMarkdown(agents, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
