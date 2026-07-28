import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  Agent,
  CursorAgentError,
  JsonlLocalAgentStore,
  getDefaultSdkStateRoot,
} from "@cursor/sdk";

import { resolveModelSelection } from "../config/model.js";
import { agentCwd } from "../persona.js";
import { createClaudeSessionAgent } from "../runtime/claude.js";
import { resolveRuntimeKind } from "../runtime/kind.js";
import type { AriaAgent, AriaRun, AriaRunResult } from "../runtime/types.js";
import { sessionDir } from "../session.js";

export type ReviewAgent = AriaAgent;

let reviewAgent: ReviewAgent | undefined;

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

type CursorSdkAgent = Awaited<ReturnType<typeof Agent.create>>;
type CursorSdkRun = Awaited<ReturnType<CursorSdkAgent["send"]>>;

function wrapCursorRun(run: CursorSdkRun): AriaRun {
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

async function createCursorReviewAgent(): Promise<AriaAgent> {
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("CURSOR_API_KEY is required for learn review");
  }

  const cwd = agentCwd();
  const local = await reviewLocalOptions(cwd);
  const model = resolveModelSelection("AARIA_LEARN_MODEL");

  try {
    const agent = await Agent.create({
      apiKey,
      model,
      local,
    });
    console.error(`[learn] review agent ready (cursor model=${model.id})`);
    return {
      runtime: "cursor",
      get agentId() {
        return agent.agentId;
      },
      async send(prompt: string) {
        return wrapCursorRun(await agent.send(prompt));
      },
      async [Symbol.asyncDispose]() {
        await agent[Symbol.asyncDispose]();
      },
    };
  } catch (err) {
    if (err instanceof CursorAgentError) {
      throw new Error(`learn review agent failed: ${err.message}`);
    }
    throw err;
  }
}

function learnSessionFile(cwd: string): string {
  return join(sessionDir(cwd), "agent-id.claude.learn.txt");
}

async function createClaudeReviewAgent(): Promise<AriaAgent> {
  const cwd = agentCwd();
  const path = learnSessionFile(cwd);
  return createClaudeSessionAgent({
    modelEnv: "AARIA_LEARN_MODEL",
    mcp: false,
    tools: [],
    trackResume: false,
    label: "learn",
    loadSessionId: () => {
      if (!existsSync(path)) return undefined;
      const id = readFileSync(path, "utf8").trim();
      return id.length > 0 ? id : undefined;
    },
    persistSessionId: (id) => {
      writeFileSync(path, `${id}\n`, "utf8");
    },
  });
}

/** Lightweight agent for learn review + curator (no MCP, separate session). */
export async function getReviewAgent(): Promise<ReviewAgent> {
  if (reviewAgent) {
    return reviewAgent;
  }

  reviewAgent =
    resolveRuntimeKind() === "claude"
      ? await createClaudeReviewAgent()
      : await createCursorReviewAgent();
  return reviewAgent;
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
