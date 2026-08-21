import { join } from "node:path";

import {
  Harness,
  type HarnessEvent,
  type HarnessOptions,
  type McpServerConfig as MxpfMcpServerConfig,
  type ModelProvider,
  type PermissionMode,
  type Run as MxpfRun,
} from "mxpf-ai-harness";

import { loadMcpServersForSdk } from "../config/mcp.js";
import { agentCwd } from "../persona.js";
import {
  loadPersistedAgentId,
  persistAgentId,
  sessionDir,
} from "../session.js";
import type { AriaAgent, AriaRun, AriaRunResult } from "./types.js";

let resumed = false;

export function wasMxpfAgentResumed(): boolean {
  return resumed;
}

/** Map mxpf events → Cursor-like assistant events for createStreamingCollector. */
function toStreamEvent(event: HarnessEvent): unknown | undefined {
  if (event.type === "assistant.text" && event.text.length > 0) {
    return {
      type: "assistant",
      message: { content: [{ type: "text", text: event.text }] },
    };
  }
  if (event.type === "error") {
    return {
      type: "result",
      errorCode: event.name || "error",
      message: event.message,
    };
  }
  return undefined;
}

function wrapMxpfRun(run: MxpfRun): AriaRun {
  return {
    get id() {
      return run.id;
    },
    get status() {
      return run.status;
    },
    stream() {
      return (async function* () {
        for await (const event of run.stream()) {
          const mapped = toStreamEvent(event);
          if (mapped) yield mapped;
        }
      })();
    },
    async wait(): Promise<AriaRunResult> {
      const result = await run.wait();
      const errText =
        result.error != null
          ? `${result.error.name}: ${result.error.message}`
          : null;
      return {
        id: result.id,
        status: result.status,
        result: result.result ?? errText,
        model: result.model ? { id: result.model.id } : null,
        durationMs: result.durationMs,
        usage: result.usage,
      };
    },
    async cancel() {
      await run.cancel();
    },
    supports(op) {
      return op === "cancel";
    },
  };
}

function resolveMxpfApiKey(): string {
  const key =
    process.env.MXPF_HARNESS_API_KEY?.trim() ||
    process.env.AARIA_LLM_API_KEY?.trim() ||
    process.env.OPENROUTER_API_KEY?.trim() ||
    process.env.ANTHROPIC_API_KEY?.trim() ||
    "";
  if (!key) {
    throw new Error(
      "AARIA_RUNTIME=mxpf requires MXPF_HARNESS_API_KEY (or AARIA_LLM_API_KEY / OPENROUTER_API_KEY)",
    );
  }
  return key;
}

function resolveMxpfBaseURL(): string | undefined {
  const raw =
    process.env.MXPF_HARNESS_BASE_URL?.trim() ||
    process.env.AARIA_LLM_BASE_URL?.trim() ||
    "";
  return raw.length > 0 ? raw : undefined;
}

function resolveMxpfProvider(baseURL?: string): ModelProvider {
  const raw =
    process.env.MXPF_HARNESS_PROVIDER?.trim().toLowerCase() ||
    process.env.AARIA_MXPF_PROVIDER?.trim().toLowerCase() ||
    "";
  if (raw === "anthropic" || raw === "openai") return raw;
  if (baseURL?.includes("openrouter") || baseURL?.includes("ollama")) {
    return "openai";
  }
  if (baseURL?.includes("anthropic")) return "anthropic";
  // Desk default for OpenRouter-style free pipes
  return "openai";
}

function resolveMxpfModelId(provider: ModelProvider): string {
  const override = process.env.MXPF_HARNESS_MODEL?.trim();
  if (override) return override;
  const raw = process.env.AARIA_MODEL?.trim();
  if (raw && raw !== "default" && !raw.startsWith("composer")) {
    return raw;
  }
  return provider === "anthropic" ? "claude-sonnet-4-5" : "openrouter/free";
}

function resolvePermissionMode(): PermissionMode {
  const raw =
    process.env.MXPF_HARNESS_PERMISSION_MODE?.trim().toLowerCase() ||
    "bypass";
  if (
    raw === "bypass" ||
    raw === "allowlist" ||
    raw === "deny-by-default"
  ) {
    return raw;
  }
  return "bypass";
}

function toMxpfMcpServers(
  cwd: string,
): Record<string, MxpfMcpServerConfig> | undefined {
  const loaded = loadMcpServersForSdk(undefined, cwd);
  if (!loaded) return undefined;

  const out: Record<string, MxpfMcpServerConfig> = {};
  for (const [name, cfg] of Object.entries(loaded)) {
    if (!cfg || typeof cfg !== "object") continue;
    const c = cfg as Record<string, unknown>;
    if (typeof c.command === "string") {
      out[name] = {
        command: c.command,
        args: Array.isArray(c.args) ? (c.args as string[]) : undefined,
        env:
          c.env && typeof c.env === "object"
            ? (c.env as Record<string, string>)
            : undefined,
        cwd: typeof c.cwd === "string" ? c.cwd : undefined,
      };
    } else if (typeof c.url === "string") {
      out[name] = {
        url: c.url,
        headers:
          c.headers && typeof c.headers === "object"
            ? (c.headers as Record<string, string>)
            : undefined,
      };
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export type CreateMxpfSessionOptions = {
  mcp?: boolean;
  /** Disable builtins for learn/curator aux agent. */
  builtins?: string[];
  trackResume?: boolean;
  label?: string;
  loadSessionId?: () => string | undefined;
  persistSessionId?: (id: string) => void;
};

export async function createMxpfSessionAgent(
  opts: CreateMxpfSessionOptions = {},
): Promise<AriaAgent> {
  const cwd = agentCwd();
  const apiKey = resolveMxpfApiKey();
  const baseURL = resolveMxpfBaseURL();
  const provider = resolveMxpfProvider(baseURL);
  const modelId = resolveMxpfModelId(provider);
  const useMcp = opts.mcp !== false;
  const mcpServers = useMcp ? toMxpfMcpServers(cwd) : undefined;
  const mxpfSessionDir = join(sessionDir(cwd), "mxpf");

  const harnessOpts: HarnessOptions = {
    cwd,
    sessionDir: mxpfSessionDir,
    model: {
      provider,
      id: modelId,
      apiKey,
      baseURL,
    },
    permissions: { mode: resolvePermissionMode() },
    tools: {
      mcp: useMcp && Boolean(mcpServers),
      builtins: opts.builtins,
    },
    ...(mcpServers ? { mcpServers } : {}),
  };

  const loadId =
    opts.loadSessionId ?? (() => loadPersistedAgentId(cwd, "mxpf"));
  const saveId =
    opts.persistSessionId ??
    ((id: string) => persistAgentId(cwd, id, "mxpf"));

  const existing = loadId();
  let harness: Harness;
  if (existing) {
    try {
      harness = await Harness.resume(existing, harnessOpts);
      if (opts.trackResume !== false) resumed = true;
      console.error(
        `[mxpf] resumed session ${existing}${opts.label ? ` (${opts.label})` : ""}`,
      );
    } catch (e) {
      console.error(
        `[mxpf] resume failed (${e instanceof Error ? e.message : e}); creating new session`,
      );
      harness = await Harness.create(harnessOpts);
      if (opts.trackResume !== false) resumed = false;
    }
  } else {
    harness = await Harness.create(harnessOpts);
    if (opts.trackResume !== false) resumed = false;
  }

  saveId(harness.sessionId);
  console.error(
    `[mxpf] ready session=${harness.sessionId} model=${provider}/${modelId}${baseURL ? ` base=${baseURL}` : ""}`,
  );

  return {
    agentId: harness.sessionId,
    runtime: "mxpf",
    async send(prompt: string) {
      const run = await harness.send(prompt);
      return wrapMxpfRun(run);
    },
    async [Symbol.asyncDispose]() {
      await harness[Symbol.asyncDispose]();
    },
  };
}

export async function createMxpfAgent(): Promise<AriaAgent> {
  return createMxpfSessionAgent({ trackResume: true });
}
