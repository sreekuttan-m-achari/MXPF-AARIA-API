import {
  createRuntimeAgent,
  wasAgentResumed as wasRuntimeResumed,
  type AriaAgent,
} from "./runtime/index.js";

export type { AriaAgent } from "./runtime/types.js";

export function wasAgentResumed(): boolean {
  return wasRuntimeResumed();
}

export async function createAgent(): Promise<AriaAgent> {
  return createRuntimeAgent();
}
