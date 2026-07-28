import {
  Agent,
  CursorAgentError,
  JsonlLocalAgentStore,
  getDefaultSdkStateRoot,
} from "@cursor/sdk";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { loadMcpServersForSdk } from "../config/mcp.js";
import { resolveModelSelection } from "../config/model.js";
import { agentCwd } from "../persona.js";
import {
  loadPersistedAgentId,
  persistAgentId,
} from "../session.js";
import type { AriaAgent, AriaRun, AriaRunResult } from "./types.js";

let resumed = false;

export function wasCursorAgentResumed(): boolean {
  return resumed;
}

async function sqliteAvailable(): Promise<boolean> {
  try {
    await import("node:sqlite");
    return true;
  } catch {
    return false;
  }
}

async function localOptions(cwd: string) {
  if (await sqliteAvailable()) {
    return { cwd };
  }

  const storeDir =
    process.env.AARIA_AGENT_STORE_DIR?.trim() ||
    join(getDefaultSdkStateRoot(cwd), "jsonl");
  mkdirSync(storeDir, { recursive: true });
  console.error(
    `[aria-agent] Node ${process.version} has no node:sqlite — using JSONL store at ${storeDir}`,
  );

  return {
    cwd,
    store: new JsonlLocalAgentStore(storeDir),
  };
}

function sdkMcpServers(cwd: string) {
  const mcpServers = loadMcpServersForSdk(undefined, cwd);
  return mcpServers ? { mcpServers } : {};
}

type CursorSdkAgent = Awaited<ReturnType<typeof Agent.create>>;
type CursorSdkRun = Awaited<ReturnType<CursorSdkAgent["send"]>>;

function wrapRun(run: CursorSdkRun): AriaRun {
  return {
    get id() {
      return run.id;
    },
    get status() {
      return run.status;
    },
    get result() {
      return run.result;
    },
    get model() {
      return run.model;
    },
    get durationMs() {
      return run.durationMs;
    },
    get requestId() {
      return run.requestId;
    },
    stream() {
      return run.stream();
    },
    async wait(): Promise<AriaRunResult> {
      const result = await run.wait();
      return {
        id: result.id,
        status: result.status,
        result: result.result,
        model: result.model,
        durationMs: result.durationMs,
        requestId: result.requestId,
        usage: result.usage,
      };
    },
    async cancel() {
      if (run.supports("cancel")) {
        await run.cancel();
      }
    },
    supports(op) {
      return run.supports(op);
    },
  };
}

function wrapAgent(agent: CursorSdkAgent): AriaAgent {
  return {
    runtime: "cursor",
    get agentId() {
      return agent.agentId;
    },
    async send(prompt: string) {
      return wrapRun(await agent.send(prompt));
    },
    async [Symbol.asyncDispose]() {
      await agent[Symbol.asyncDispose]();
    },
  };
}

export async function createCursorAgent(): Promise<AriaAgent> {
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "CURSOR_API_KEY is required when AARIA_RUNTIME=cursor (copy .env-sample to .env)",
    );
  }

  const cwd = agentCwd();
  const local = await localOptions(cwd);
  const model = resolveModelSelection("AARIA_MODEL");
  console.error(`[aria-agent] runtime=cursor model=${model.id}`);
  const mcp = sdkMcpServers(cwd);
  const persistedId = loadPersistedAgentId(cwd, "cursor");

  try {
    if (persistedId) {
      try {
        const agent = await Agent.resume(persistedId, {
          apiKey,
          local,
          model,
          ...mcp,
        });
        resumed = true;
        console.error(`[aria-agent] Resumed Cursor session ${agent.agentId}`);
        return wrapAgent(agent);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[aria-agent] Could not resume ${persistedId} (${msg}); creating new session`,
        );
      }
    }

    const agent = await Agent.create({
      apiKey,
      model,
      local,
      ...mcp,
    });
    resumed = false;
    persistAgentId(cwd, agent.agentId, "cursor");
    console.error(`[aria-agent] New Cursor session ${agent.agentId}`);
    return wrapAgent(agent);
  } catch (err) {
    if (err instanceof CursorAgentError) {
      throw new Error(`agent startup failed: ${err.message}`);
    }
    throw err;
  }
}
