import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildExecUpgradeCmd,
  chooseUpdateAction,
  dispatchArgsForAgent,
} from "../fleet/update.js";

test("buildExecUpgradeCmd includes --yes and optional flags", () => {
  const cmd = buildExecUpgradeCmd({
    refreshHost: true,
    reinstall: true,
  });
  assert.match(cmd, /install-upgrade\.sh/);
  assert.match(cmd, /--yes/);
  assert.match(cmd, /--refresh-host/);
  assert.match(cmd, /--reinstall/);
  assert.match(cmd, /nohup/);
});

test("chooseUpdateAction prefers self.update when cap present", () => {
  assert.equal(
    chooseUpdateAction({
      agentId: "a1",
      labels: {},
      caps: ["health", "exec", "update"],
      status: "approved",
    }),
    "self.update",
  );
  assert.equal(
    chooseUpdateAction({
      agentId: "a2",
      labels: {},
      caps: ["health", "exec"],
      status: "approved",
    }),
    "exec",
  );
});

test("dispatchArgsForAgent shapes payload", () => {
  const withCap = dispatchArgsForAgent(
    {
      agentId: "a1",
      labels: {},
      caps: ["update"],
      status: "approved",
    },
    { refreshHost: true },
  );
  assert.equal(withCap.action, "self.update");
  assert.equal(withCap.args.refreshHost, true);

  const fallback = dispatchArgsForAgent(
    {
      agentId: "a2",
      labels: {},
      caps: ["exec"],
      status: "approved",
    },
    {},
  );
  assert.equal(fallback.action, "exec");
  assert.equal(typeof fallback.args.cmd, "string");
});
