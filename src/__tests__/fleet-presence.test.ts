import assert from "node:assert/strict";
import { test } from "node:test";

import { currentTaskLabel, fleetPresence } from "../fleet/presence.js";

test("fleetPresence pending/online/idle/offline", () => {
  assert.equal(fleetPresence("pending"), "pending");
  assert.equal(fleetPresence("approved"), "offline");
  assert.equal(
    fleetPresence("approved", new Date().toISOString()),
    "online",
  );
  const idleAt = new Date(Date.now() - 5 * 60_000).toISOString();
  assert.equal(fleetPresence("approved", idleAt), "idle");
  const oldAt = new Date(Date.now() - 60 * 60_000).toISOString();
  assert.equal(fleetPresence("approved", oldAt), "offline");
});

test("currentTaskLabel prefers in-flight job", () => {
  assert.equal(
    currentTaskLabel({
      currentJob: {
        jobId: "abc12345-xxxx",
        action: "exec",
        summary: "uname -a",
        dispatchedAt: new Date().toISOString(),
      },
    }),
    "exec: uname -a",
  );
  assert.equal(
    currentTaskLabel({
      lastResult: { action: "health", ok: true },
    }),
    "last health · ok",
  );
});
