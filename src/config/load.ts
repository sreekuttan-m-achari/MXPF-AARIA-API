import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

import { resolveRuntimeKind } from "../runtime/kind.js";
import type { AgentRuntimeKind } from "../runtime/types.js";

export type AariaHubConfig = {
  timezone?: string;
  agentCwd?: string;
};

export type CursorBrainConfig = {
  kind: "cursor";
  model?: string;
  learnModel?: string;
};

export type ClaudeBrainConfig = {
  kind: "claude";
  model?: string;
  learnModel?: string;
};

export type MxpfBrainConfig = {
  kind: "mxpf";
  model?: string;
  learnModel?: string;
  provider?: string;
  baseUrl?: string;
  permissionMode?: string;
};

export type BrainConfig = CursorBrainConfig | ClaudeBrainConfig | MxpfBrainConfig;

export type LoadedAariaConfig = {
  runtime: AgentRuntimeKind;
  configDir: string;
  hub: AariaHubConfig;
  brain: BrainConfig;
};

let cached: LoadedAariaConfig | undefined;

export function resetAariaConfigCache(): void {
  cached = undefined;
}

export function aariaConfigDir(): string {
  const override = process.env.AARIA_CONFIG_DIR?.trim();
  return override && override.length > 0
    ? override
    : join(process.cwd(), "config");
}

function readYamlObject(path: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return {};
  }
  const parsed: unknown = parseYaml(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return parsed as Record<string, unknown>;
}

function optString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

function parseHub(obj: Record<string, unknown>): AariaHubConfig {
  return {
    timezone: optString(obj, "timezone"),
    agentCwd: optString(obj, "agentCwd"),
  };
}

function parseBrain(
  runtime: AgentRuntimeKind,
  obj: Record<string, unknown>,
): BrainConfig {
  if (runtime === "claude") {
    return {
      kind: "claude",
      model: optString(obj, "model"),
      learnModel: optString(obj, "learnModel"),
    };
  }
  if (runtime === "mxpf") {
    return {
      kind: "mxpf",
      model: optString(obj, "model"),
      provider: optString(obj, "provider"),
      baseUrl: optString(obj, "baseUrl"),
      permissionMode: optString(obj, "permissionMode"),
    };
  }
  return {
    kind: "cursor",
    model: optString(obj, "model"),
    learnModel: optString(obj, "learnModel"),
  };
}

function brainFileName(runtime: AgentRuntimeKind): string {
  return `${runtime}.yaml`;
}

/** Load hub YAML + exactly one brain file selected by AARIA_RUNTIME. */
export function loadAariaConfig(): LoadedAariaConfig {
  if (cached) return cached;
  const runtime = resolveRuntimeKind();
  const configDir = aariaConfigDir();
  const hub = parseHub(readYamlObject(join(configDir, "aaria.yaml")));
  const brain = parseBrain(
    runtime,
    readYamlObject(join(configDir, "providers", brainFileName(runtime))),
  );
  cached = { runtime, configDir, hub, brain };
  return cached;
}

export function firstNonEmpty(
  ...values: Array<string | undefined>
): string | undefined {
  for (const v of values) {
    if (v && v.trim().length > 0) return v.trim();
  }
  return undefined;
}
