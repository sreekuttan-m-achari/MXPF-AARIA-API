import { mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  Agent,
  CursorAgentError,
  JsonlLocalAgentStore,
  getDefaultSdkStateRoot,
} from "@cursor/sdk";

import { agentCwd } from "../persona.js";

export type ReviewAgent = Awaited<ReturnType<typeof Agent.create>>;

let reviewAgent: ReviewAgent | undefined;

function learnModelId(): string {
  const override = process.env.AARIA_LEARN_MODEL?.trim();
  return override && override.length > 0 ? override : "composer-2";
}

async function sqliteAvailable(): Promise<boolean> {
  try {
    await import("node:sqlite");
    return true;
  } catch {
    return false;
  }
}

async function reviewLocalOptions(cwd: string) {
  if (await sqliteAvailable()) {
    return { cwd };
  }

  const storeDir =
    process.env.AARIA_LEARN_STORE_DIR?.trim() ||
    join(getDefaultSdkStateRoot(cwd), "jsonl-learn");
  mkdirSync(storeDir, { recursive: true });
  return {
    cwd,
    store: new JsonlLocalAgentStore(storeDir),
  };
}

/** Lightweight agent for learn review + curator (no MCP, separate session). */
export async function getReviewAgent(): Promise<ReviewAgent> {
  if (reviewAgent) {
    return reviewAgent;
  }

  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("CURSOR_API_KEY is required for learn review");
  }

  const cwd = agentCwd();
  const local = await reviewLocalOptions(cwd);
  const model = { id: learnModelId() as "composer-2" };

  try {
    reviewAgent = await Agent.create({
      apiKey,
      model,
      local,
    });
    console.error(`[learn] review agent ready (model=${learnModelId()})`);
    return reviewAgent;
  } catch (err) {
    if (err instanceof CursorAgentError) {
      throw new Error(`learn review agent failed: ${err.message}`);
    }
    throw err;
  }
}

export async function shutdownReviewAgent(): Promise<void> {
  if (!reviewAgent) {
    return;
  }
  try {
    await reviewAgent[Symbol.asyncDispose]();
  } finally {
    reviewAgent = undefined;
  }
}
