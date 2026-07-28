/** Shared agent harness surface for Cursor + Claude runtimes. */

export type AgentRuntimeKind = "cursor" | "claude";

export type AriaRunResult = {
  id: string;
  status: "finished" | "error" | "cancelled" | string;
  result?: string | null;
  model?: { id?: string } | null;
  durationMs?: number;
  requestId?: string;
  usage?: unknown;
};

export type AriaRun = {
  readonly id: string;
  readonly status: string;
  readonly result?: string;
  readonly model?: { id?: string };
  readonly durationMs?: number;
  readonly requestId?: string;
  stream(): AsyncIterable<unknown>;
  wait(): Promise<AriaRunResult>;
  cancel(): Promise<void>;
  supports(op: "cancel" | "conversation"): boolean;
};

export type AriaAgent = {
  readonly agentId: string;
  readonly runtime: AgentRuntimeKind;
  send(prompt: string): Promise<AriaRun>;
  [Symbol.asyncDispose](): PromiseLike<void>;
};
