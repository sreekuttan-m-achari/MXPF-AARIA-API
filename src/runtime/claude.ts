import { randomUUID } from "node:crypto";

import { query } from "@anthropic-ai/claude-agent-sdk";

import { loadMcpServersForSdk } from "../config/mcp.js";
import { agentCwd } from "../persona.js";
import {
  loadPersistedAgentId,
  persistAgentId,
} from "../session.js";
import { resolveClaudeModelId } from "./kind.js";
import type { AriaAgent, AriaRun, AriaRunResult } from "./types.js";

let resumed = false;

export function wasClaudeAgentResumed(): boolean {
  return resumed;
}

type ClaudeMcpServers = NonNullable<
  Parameters<typeof query>[0]["options"]
>["mcpServers"];

function loadClaudeMcp(cwd: string): ClaudeMcpServers | undefined {
  const servers = loadMcpServersForSdk(undefined, cwd);
  if (!servers) return undefined;
  // Cursor MCP JSON is compatible enough for stdio/http shapes Claude expects.
  return servers as ClaudeMcpServers;
}

function claudeBaseOptions(
  cwd: string,
  model: string,
  opts?: { mcp?: boolean; tools?: string[] },
) {
  const useMcp = opts?.mcp !== false;
  const mcpServers = useMcp ? loadClaudeMcp(cwd) : undefined;
  const allowedTools =
    opts?.tools ??
    [
      "Read",
      "Write",
      "Edit",
      "Bash",
      "Glob",
      "Grep",
      "WebSearch",
      "WebFetch",
      "Agent",
      ...(mcpServers
        ? Object.keys(mcpServers).map((name) => `mcp__${name}__*`)
        : []),
    ];
  return {
    cwd,
    model,
    permissionMode: "bypassPermissions" as const,
    allowDangerouslySkipPermissions: true,
    allowedTools,
    ...(mcpServers ? { mcpServers } : {}),
  };
}

/** Normalize Claude SDK messages into Cursor-like stream events for collectors. */
function toStreamEvent(message: unknown): unknown | undefined {
  if (!message || typeof message !== "object") return undefined;
  const m = message as Record<string, unknown>;

  if (m.type === "assistant") {
    const content = (m.message as { content?: unknown } | undefined)?.content;
    if (!Array.isArray(content)) return undefined;
    const texts: { type: "text"; text: string }[] = [];
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        (block as { type?: string }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string"
      ) {
        const text = (block as { text: string }).text;
        if (text.length > 0) texts.push({ type: "text", text });
      }
    }
    if (texts.length === 0) return undefined;
    return { type: "assistant", message: { content: texts } };
  }

  if (m.type === "result") {
    const subtype = m.subtype;
    if (
      m.is_error === true ||
      subtype === "error" ||
      subtype === "error_during_execution"
    ) {
      return {
        type: "result",
        errorCode: typeof subtype === "string" ? subtype : "error",
      };
    }
    // Final result text is captured in wait(); avoid duplicating streamed assistant text.
  }

  return undefined;
}

function extractSessionId(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const m = message as Record<string, unknown>;
  if (m.type === "system" && m.subtype === "init") {
    if (typeof m.session_id === "string") return m.session_id;
    const data = m.data as { session_id?: string } | undefined;
    if (data && typeof data.session_id === "string") return data.session_id;
  }
  if (typeof m.session_id === "string") return m.session_id;
  return undefined;
}

function createClaudeRun(
  prompt: string,
  sessionId: string,
  model: string,
  cwd: string,
  onSessionId: (id: string) => void,
  optionOverrides?: { mcp?: boolean; tools?: string[] },
): AriaRun {
  const runId = randomUUID();
  const abort = new AbortController();
  let status: string = "running";
  let resultText: string | undefined;
  let durationMs: number | undefined;
  let waitPromise: Promise<AriaRunResult> | undefined;
  const started = Date.now();

  const events: unknown[] = [];
  let resolveEvent: (() => void) | undefined;
  let streamDone = false;

  function pushEvent(event: unknown) {
    events.push(event);
    resolveEvent?.();
    resolveEvent = undefined;
  }

  async function* stream(): AsyncGenerator<unknown> {
    // Kick off consumption if wait() hasn't.
    void ensureRunning();
    while (!streamDone || events.length > 0) {
      if (events.length === 0) {
        await new Promise<void>((resolve) => {
          resolveEvent = resolve;
        });
        continue;
      }
      yield events.shift()!;
    }
  }

  async function runQuery(): Promise<AriaRunResult> {
    try {
      const options = {
        ...claudeBaseOptions(cwd, model, optionOverrides),
        resume: sessionId,
        abortController: abort,
      };

      for await (const message of query({ prompt, options })) {
        const nextId = extractSessionId(message);
        if (nextId && nextId !== sessionId) {
          onSessionId(nextId);
        }

        const event = toStreamEvent(message);
        if (event) {
          pushEvent(event);
          if (
            event &&
            typeof event === "object" &&
            (event as { type?: string }).type === "assistant"
          ) {
            const blocks = (
              event as { message: { content: { type: string; text: string }[] } }
            ).message.content;
            for (const b of blocks) {
              if (b.type === "text") {
                resultText = (resultText ?? "") + b.text;
              }
            }
          }
        }

        if (
          message &&
          typeof message === "object" &&
          (message as { type?: string }).type === "result"
        ) {
          const m = message as {
            subtype?: string;
            result?: string;
            is_error?: boolean;
          };
          if (typeof m.result === "string") {
            resultText = m.result;
          }
          if (m.is_error || m.subtype === "error" || m.subtype === "error_during_execution") {
            status = "error";
          } else if (abort.signal.aborted) {
            status = "cancelled";
          } else {
            status = "finished";
          }
        }
      }

      if (status === "running") {
        status = abort.signal.aborted ? "cancelled" : "finished";
      }
    } catch (err) {
      if (abort.signal.aborted) {
        status = "cancelled";
      } else {
        status = "error";
        resultText = err instanceof Error ? err.message : String(err);
        pushEvent({
          type: "result",
          errorCode: "claude_query_error",
        });
      }
    } finally {
      durationMs = Date.now() - started;
      streamDone = true;
      resolveEvent?.();
      resolveEvent = undefined;
    }

    return {
      id: runId,
      status,
      result: resultText,
      model: { id: model },
      durationMs,
    };
  }

  function ensureRunning(): Promise<AriaRunResult> {
    if (!waitPromise) {
      waitPromise = runQuery();
    }
    return waitPromise;
  }

  return {
    id: runId,
    get status() {
      return status;
    },
    get result() {
      return resultText;
    },
    get model() {
      return { id: model };
    },
    get durationMs() {
      return durationMs;
    },
    get requestId() {
      return undefined;
    },
    stream,
    wait: () => ensureRunning(),
    async cancel() {
      abort.abort();
      status = "cancelled";
    },
    supports(op) {
      return op === "cancel";
    },
  };
}

export type ClaudeSessionOptions = {
  /** Env var for model id (default AARIA_MODEL). */
  modelEnv?: string;
  /** Persist/load session id here instead of main agent-id.claude.txt. */
  loadSessionId: () => string | undefined;
  persistSessionId: (id: string) => void;
  /** Include MCP servers (default true for main desk agent). */
  mcp?: boolean;
  tools?: string[];
  label?: string;
  /** When true, updates wasClaudeAgentResumed(). */
  trackResume?: boolean;
};

/**
 * Claude Agent SDK has no durable Agent object — we hold a session id and
 * call `query({ resume })` per turn.
 */
export async function createClaudeSessionAgent(
  opts: ClaudeSessionOptions,
): Promise<AriaAgent> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is required when AARIA_RUNTIME=claude",
    );
  }

  const cwd = agentCwd();
  const model = resolveClaudeModelId(opts.modelEnv ?? "AARIA_MODEL");
  const label = opts.label ?? "claude";
  console.error(`[aria-agent] runtime=claude (${label}) model=${model}`);

  let sessionId = opts.loadSessionId();
  if (sessionId) {
    if (opts.trackResume) resumed = true;
    console.error(`[aria-agent] Resuming Claude session ${sessionId} (${label})`);
  } else {
    if (opts.trackResume) resumed = false;
    sessionId = await bootstrapClaudeSession(cwd, model, {
      mcp: opts.mcp,
      tools: opts.tools,
    });
    opts.persistSessionId(sessionId);
    console.error(`[aria-agent] New Claude session ${sessionId} (${label})`);
  }

  let currentSessionId = sessionId;
  const optionOverrides = { mcp: opts.mcp, tools: opts.tools };

  return {
    runtime: "claude",
    get agentId() {
      return currentSessionId;
    },
    async send(prompt: string) {
      return createClaudeRun(
        prompt,
        currentSessionId,
        model,
        cwd,
        (id) => {
          currentSessionId = id;
          opts.persistSessionId(id);
        },
        optionOverrides,
      );
    },
    async [Symbol.asyncDispose]() {
      // No long-lived subprocess to dispose; query() owns its CLI per turn.
    },
  };
}

export async function createClaudeAgent(): Promise<AriaAgent> {
  const cwd = agentCwd();
  return createClaudeSessionAgent({
    modelEnv: "AARIA_MODEL",
    loadSessionId: () => loadPersistedAgentId(cwd, "claude"),
    persistSessionId: (id) => persistAgentId(cwd, id, "claude"),
    mcp: true,
    trackResume: true,
    label: "main",
  });
}

async function bootstrapClaudeSession(
  cwd: string,
  model: string,
  optionOverrides?: { mcp?: boolean; tools?: string[] },
): Promise<string> {
  let sessionId: string | undefined;
  try {
    for await (const message of query({
      prompt: "Reply with exactly: ok",
      options: {
        ...claudeBaseOptions(cwd, model, optionOverrides),
        maxTurns: 1,
      },
    })) {
      const id = extractSessionId(message);
      if (id) sessionId = id;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Claude agent startup failed: ${msg}`);
  }
  if (!sessionId) {
    // Fallback: synthetic id — resume may fail and we recreate next boot.
    sessionId = randomUUID();
    console.error(
      `[aria-agent] Claude init yielded no session_id; using ${sessionId}`,
    );
  }
  return sessionId;
}
