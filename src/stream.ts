import type {
  LocalRunStreamSdkMessageEvent,
  Run,
  RunResult,
  SDKAssistantMessage,
  SDKMessage,
} from "@cursor/sdk";

import type { AriaAgent } from "./agent.js";
import { withAgentBusyRecovery } from "./agent-busy.js";
import { ChatCancelledError } from "./errors.js";
import {
  registerActiveRun,
  unregisterActiveRun,
} from "./runs.js";
import { recordRunUsage } from "./usage.js";

type Collector = {
  reset: () => void;
  handleEvent: (event: unknown) => void;
  getText: () => string;
  getFailureHint: () => string | undefined;
};

function isWrappedStreamEvent(e: unknown): e is LocalRunStreamSdkMessageEvent {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { type?: unknown }).type === "sdk_message" &&
    "message" in e &&
    typeof (e as { message?: unknown }).message === "object" &&
    (e as { message?: { type?: unknown } }).message !== null
  );
}

function isSdkMessage(e: unknown): e is SDKMessage {
  return (
    typeof e === "object" &&
    e !== null &&
    "type" in e &&
    typeof (e as { type: unknown }).type === "string"
  );
}

export function createStreamingCollector(
  onChunk?: (text: string) => void,
): Collector {
  let text = "";
  let lastStatusMessage: string | undefined;
  let lastErrorCode: string | undefined;

  function appendAssistant(msg: SDKAssistantMessage): void {
    for (const block of msg.message.content) {
      if (block.type === "text" && block.text.length > 0) {
        text += block.text;
        onChunk?.(block.text);
      }
    }
  }

  function reset(): void {
    text = "";
    lastStatusMessage = undefined;
    lastErrorCode = undefined;
  }

  function handleEvent(event: unknown): void {
    if (
      typeof event === "object" &&
      event !== null &&
      (event as { type?: unknown }).type === "result"
    ) {
      const code = (event as { errorCode?: unknown }).errorCode;
      if (typeof code === "string" && code.length > 0) {
        lastErrorCode = code;
      }
      return;
    }

    if (isWrappedStreamEvent(event)) {
      if (event.message.type === "assistant") {
        appendAssistant(event.message);
      } else if (event.message.type === "status") {
        if (event.message.message?.trim()) {
          lastStatusMessage = event.message.message.trim();
        }
        if (event.message.status === "ERROR" || event.message.status === "EXPIRED") {
          lastStatusMessage =
            lastStatusMessage || `run status ${event.message.status}`;
        }
      }
      return;
    }
    if (isSdkMessage(event) && event.type === "assistant") {
      appendAssistant(event);
    } else if (isSdkMessage(event) && event.type === "status") {
      if (event.message?.trim()) {
        lastStatusMessage = event.message.trim();
      }
    }
  }

  return {
    reset,
    handleEvent,
    getText: () => text,
    getFailureHint: () => {
      const parts: string[] = [];
      if (lastErrorCode) {
        parts.push(`errorCode=${lastErrorCode}`);
      }
      if (lastStatusMessage) {
        parts.push(lastStatusMessage);
      }
      return parts.length > 0 ? parts.join(" · ") : undefined;
    },
  };
}

function describeRunFailure(
  result: RunResult,
  run: Run,
  streamHint?: string,
): string {
  const detail = result.result?.trim() || run.result?.trim() || streamHint?.trim();
  if (detail) {
    return detail;
  }
  return `agent run failed (${result.id})`;
}

export function isRecoverableRunError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  const message = err.message.toLowerCase();
  return (
    message.includes("agent run failed") ||
    message.includes("network request failed") ||
    message.includes("network error") ||
    message.includes("service unavailable")
  );
}

export async function runChatTurn(
  agent: AriaAgent,
  prompt: string,
  onChunk?: (text: string) => void,
  chatId?: string,
): Promise<string> {
  return withAgentBusyRecovery(agent.agentId, () =>
    runChatTurnOnce(agent, prompt, onChunk, chatId),
  );
}

async function runChatTurnOnce(
  agent: AriaAgent,
  prompt: string,
  onChunk?: (text: string) => void,
  chatId?: string,
): Promise<string> {
  const collector = createStreamingCollector(onChunk);
  collector.reset();

  const run = await agent.send(prompt);
  if (chatId) {
    registerActiveRun(chatId, run);
  }

  try {
    for await (const event of run.stream()) {
      collector.handleEvent(event);
    }
    const result = await run.wait();
    const modelId = result.model?.id ?? run.model?.id;
    if (result.status === "cancelled") {
      recordRunUsage({
        id: result.id,
        status: "cancelled",
        model: modelId,
        durationMs: result.durationMs ?? run.durationMs,
        requestId: result.requestId ?? run.requestId,
        usage: result.usage,
      });
      throw new ChatCancelledError(collector.getText().trim());
    }
    if (result.status === "error") {
      recordRunUsage({
        id: result.id,
        status: "error",
        model: modelId,
        durationMs: result.durationMs ?? run.durationMs,
        requestId: result.requestId ?? run.requestId,
        usage: result.usage,
      });
      const hint = collector.getFailureHint();
      const message = describeRunFailure(result, run, hint);
      console.error(
        `[aria-run] error run=${result.id}: ${message}` +
          ` model=${JSON.stringify(result.model ?? run.model ?? null)}` +
          ` durationMs=${result.durationMs ?? run.durationMs ?? "?"}` +
          ` requestId=${result.requestId ?? run.requestId ?? "?"}` +
          (hint ? ` stream=${hint}` : "") +
          ` resultJson=${JSON.stringify({
            id: result.id,
            status: result.status,
            result: result.result ?? null,
            usage: result.usage ?? null,
          })}`,
      );
      throw new Error(message);
    }

    recordRunUsage({
      id: result.id,
      status: "finished",
      model: modelId,
      durationMs: result.durationMs ?? run.durationMs,
      requestId: result.requestId ?? run.requestId,
      usage: result.usage,
    });

    const reply = collector.getText().trim();
    return reply || "(no reply)";
  } catch (err) {
    if (err instanceof ChatCancelledError) {
      throw err;
    }
    if (run.status === "cancelled") {
      throw new ChatCancelledError(collector.getText().trim());
    }
    throw err;
  } finally {
    if (chatId) {
      unregisterActiveRun(chatId);
    }
  }
}
