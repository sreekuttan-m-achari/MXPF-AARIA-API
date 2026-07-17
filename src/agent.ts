import { mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  Agent,
  CursorAgentError,
  JsonlLocalAgentStore,
  getDefaultSdkStateRoot,
} from "@cursor/sdk";

import { agentCwd } from "./persona.js";
import { loadMcpServersForSdk } from "./config/mcp.js";
import { resolveModelSelection } from "./config/model.js";
import { loadPersistedAgentId, persistAgentId } from "./session.js";

export type AriaAgent = Awaited<ReturnType<typeof Agent.create>>;

let resumed = false;

export function wasAgentResumed(): boolean {
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

export async function createAgent(): Promise<AriaAgent> {
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "CURSOR_API_KEY is required (copy server/.env-sample to server/.env)",
    );
  }

  const cwd = agentCwd();
  const local = await localOptions(cwd);
  const model = resolveModelSelection("AARIA_MODEL");
  console.error(`[aria-agent] model=${model.id}`);
  const mcp = sdkMcpServers(cwd);
  const persistedId = loadPersistedAgentId(cwd);

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
        console.error(`[aria-agent] Resumed session ${agent.agentId}`);
        return agent;
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
    persistAgentId(cwd, agent.agentId);
    console.error(`[aria-agent] New session ${agent.agentId}`);
    return agent;
  } catch (err) {
    if (err instanceof CursorAgentError) {
      throw new Error(`agent startup failed: ${err.message}`);
    }
    throw err;
  }
}
