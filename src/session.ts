import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { getDefaultSdkStateRoot } from "@cursor/sdk";

import type { AgentRuntimeKind } from "./runtime/types.js";
import { resolveRuntimeKind } from "./runtime/kind.js";

export function sessionDir(cwd: string): string {
  const override = process.env.AARIA_SESSION_DIR?.trim();
  if (override) {
    mkdirSync(override, { recursive: true });
    return override;
  }

  let dir: string;
  try {
    dir = join(getDefaultSdkStateRoot(cwd), "aria-api");
  } catch {
    dir = join(homedir(), ".aaria", "session");
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function agentIdPath(
  cwd: string,
  runtime: AgentRuntimeKind = resolveRuntimeKind(),
): string {
  return join(sessionDir(cwd), `agent-id.${runtime}.txt`);
}

/** Legacy path used before per-runtime files (Cursor only). */
function legacyAgentIdPath(cwd: string): string {
  return join(sessionDir(cwd), "agent-id.txt");
}

export function loadPersistedAgentId(
  cwd: string,
  runtime: AgentRuntimeKind = resolveRuntimeKind(),
): string | undefined {
  const path = agentIdPath(cwd, runtime);
  if (existsSync(path)) {
    const id = readFileSync(path, "utf8").trim();
    if (id.length > 0) return id;
  }
  // Migrate pre-runtime Cursor session files.
  if (runtime === "cursor") {
    const legacy = legacyAgentIdPath(cwd);
    if (existsSync(legacy)) {
      const id = readFileSync(legacy, "utf8").trim();
      if (id.length > 0) return id;
    }
  }
  return undefined;
}

export function persistAgentId(
  cwd: string,
  agentId: string,
  runtime: AgentRuntimeKind = resolveRuntimeKind(),
): void {
  writeFileSync(agentIdPath(cwd, runtime), `${agentId}\n`, "utf8");
}

export function clearPersistedAgentId(
  cwd: string,
  runtime: AgentRuntimeKind = resolveRuntimeKind(),
): void {
  const path = agentIdPath(cwd, runtime);
  if (existsSync(path)) {
    writeFileSync(path, "", "utf8");
  }
  if (runtime === "cursor") {
    const legacy = legacyAgentIdPath(cwd);
    if (existsSync(legacy)) {
      writeFileSync(legacy, "", "utf8");
    }
  }
}

export function morningBriefDatePath(cwd: string): string {
  return join(sessionDir(cwd), "morning-brief-date.txt");
}
