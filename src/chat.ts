import { resetAgentSession } from "./agent-manager.js";
import type { AriaAgent } from "./agent.js";
import {
  logConversation,
  logStreamChunk,
  type ConversationTransport,
} from "./debug.js";
import { isChatCancelled } from "./errors.js";
import { scheduleLearnReview } from "./learn/review.js";
import { expandWithSkill } from "./skills/index.js";
import {
  createStreamSpeechTracker,
  pullStreamSpeech,
} from "./spoken.js";
import { waitForWarmup } from "./warmup.js";
import { isRecoverableRunError, runChatTurn } from "./stream.js";
import { enqueueSpeech, stopSpeech } from "./tts.js";

export type ChatTurnOptions = {
  learn?: boolean;
  /** Override voice; default on for interactive chats, off for job/brief. */
  voice?: boolean;
};

const SILENT_TRANSPORTS = new Set<ConversationTransport>(["job", "brief"]);

function voiceEnabledForTurn(
  transport: ConversationTransport,
  options?: ChatTurnOptions,
): boolean {
  if (options?.voice !== undefined) return options.voice;
  return !SILENT_TRANSPORTS.has(transport);
}

export async function handleChatTurn(
  agent: AriaAgent,
  transport: ConversationTransport,
  id: string,
  message: string,
  onChunk?: (text: string) => void,
  allowSessionReset = true,
  options?: ChatTurnOptions,
): Promise<string> {
  await waitForWarmup();
  const started = Date.now();
  const expanded = expandWithSkill(message);
  const voiceOn = voiceEnabledForTurn(transport, options);
  const speech = createStreamSpeechTracker();
  let streamed = "";

  try {
    const reply = await runChatTurn(
      agent,
      expanded,
      (text) => {
        streamed += text;
        logStreamChunk(id, text);
        onChunk?.(text);
        // Speak only assistant text as it streams — never echo the user message.
        if (voiceOn) {
          for (const unit of pullStreamSpeech(streamed, speech)) {
            enqueueSpeech(unit);
          }
        }
      },
      id,
    );
    logConversation({
      transport,
      id,
      user: message,
      reply,
      durationMs: Date.now() - started,
    });
    if (voiceOn) {
      // Finish any leftover sentences without interrupting mid-stream speech.
      for (const unit of pullStreamSpeech(reply, speech, { finalize: true })) {
        enqueueSpeech(unit);
      }
    }
    if (options?.learn !== false) {
      scheduleLearnReview(agent, message, reply);
    }
    return reply;
  } catch (err) {
    if (isChatCancelled(err)) {
      stopSpeech();
      logConversation({
        transport,
        id,
        user: message,
        error: "cancelled",
        durationMs: Date.now() - started,
      });
      throw err;
    }
    if (allowSessionReset && isRecoverableRunError(err)) {
      console.error(
        `[aria-agent] Run failed (${err instanceof Error ? err.message : err}); resetting session and retrying once`,
      );
      const fresh = await resetAgentSession();
      await waitForWarmup();
      return handleChatTurn(
        fresh,
        transport,
        id,
        message,
        onChunk,
        false,
        options,
      );
    }
    const error = err instanceof Error ? err.message : String(err);
    logConversation({
      transport,
      id,
      user: message,
      error,
      durationMs: Date.now() - started,
    });
    throw err;
  }
}
