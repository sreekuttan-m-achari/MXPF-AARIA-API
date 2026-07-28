import { resolveRuntimeKind } from "./kind.js";
import { createClaudeAgent, wasClaudeAgentResumed } from "./claude.js";
import { createCursorAgent, wasCursorAgentResumed } from "./cursor.js";
import type { AriaAgent } from "./types.js";

export type { AriaAgent, AriaRun, AriaRunResult, AgentRuntimeKind } from "./types.js";
export { resolveRuntimeKind, resolveClaudeModelId } from "./kind.js";

export async function createRuntimeAgent(): Promise<AriaAgent> {
  const kind = resolveRuntimeKind();
  if (kind === "claude") {
    return createClaudeAgent();
  }
  return createCursorAgent();
}

export function wasAgentResumed(): boolean {
  return resolveRuntimeKind() === "claude"
    ? wasClaudeAgentResumed()
    : wasCursorAgentResumed();
}
