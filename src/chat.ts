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
  buildAckLineSpeech,
  buildReplySpeech,
  hasSpeakableFirstSentence,
} from "./spoken.js";
import { waitForWarmup } from "./warmup.js";
import { isRecoverableRunError, runChatTurn } from "./stream.js";
import { speak, stopSpeech } from "./tts.js";

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
  let spokeAck = false;
  let ackLine = "";
  let streamed = "";
  try {
    const reply = await runChatTurn(
      agent,
      expanded,
      (text) => {
        streamed += text;
        logStreamChunk(id, text);
        onChunk?.(text);
        // Speak the opening acknowledgement as soon as the first sentence lands.
        if (voiceOn && !spokeAck && hasSpeakableFirstSentence(streamed)) {
          const line = buildAckLineSpeech(streamed);
          if (line) {
            spokeAck = true;
            ackLine = line;
            speak(line);
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
      const finalLine = buildReplySpeech(reply);
      // Speak the completed reply (char-budgeted). Skip if it's the same as the ack.
      if (finalLine && finalLine !== ackLine) {
        speak(finalLine);
      } else if (finalLine && !spokeAck) {
        speak(finalLine);
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
