import WebSocket from "ws";

import { wsUrl } from "./config.js";

export type ContextPayload = {
  window: {
    usedTokens: number | null;
    limitTokens: number;
    percent: number | null;
    model?: string;
  };
  prompts: {
    soulChars: number;
    userChars: number;
    userLearnedChars: number;
    userLearnedLimit: number;
    memoryChars: number;
    memoryLimit: number;
    memoryEntries: number;
    fleetChars: number;
    standingChars: number;
  };
};

type Outbound =
  | { type: "ready"; greeting?: string; warm?: boolean; sessionId?: string; userName?: string; morningBrief?: "pending" | "skip" }
  | { type: "greeting"; text: string }
  | { type: "brief"; text: string }
  | { type: "brief_chunk"; text: string }
  | { type: "pong" }
  | { type: "chunk"; id: string; text: string }
  | { type: "done"; id: string; reply: string; context?: ContextPayload }
  | { type: "cancelled"; id: string; reply?: string }
  | { type: "error"; id?: string; error: string }
  | {
      type: "learned";
      target: "memory" | "user" | "skill";
      preview: string;
      staged?: boolean;
      pendingId?: string;
    };

export type MorningBriefHandler = {
  onChunk?: (text: string) => void;
  onBrief: (text: string) => void;
};

export type LearnedEvent = Extract<Outbound, { type: "learned" }>;

export type ChatHandlers = {
  onChunk: (text: string) => void;
  onDone: (reply: string, context?: ContextPayload) => void;
  onCancelled: (partial?: string) => void;
  onError: (message: string) => void;
};

export type LearnHandler = (event: LearnedEvent) => void;
export type GreetingHandler = (text: string) => void;

export class AriaWsClient {
  private ws: WebSocket | undefined;
  private chatId = 0;
  private activeHandlers: ChatHandlers | undefined;
  private learnHandler: LearnHandler | undefined;
  private morningBriefHandler: MorningBriefHandler | undefined;
  private greetingHandler: GreetingHandler | undefined;

  async connect(): Promise<{
    greeting?: string;
    warm?: boolean;
    userName?: string;
    morningBrief?: "pending" | "skip";
  }> {
    const url = wsUrl();
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error(`timed out connecting to ${url}`));
      }, 10_000);

      ws.once("open", () => {
        ws.send(JSON.stringify({ type: "ping" }));
      });

      ws.on("message", (raw) => {
        let msg: Outbound;
        try {
          msg = JSON.parse(String(raw)) as Outbound;
        } catch {
          return;
        }

        if (msg.type === "ready") {
          clearTimeout(timeout);
          resolve({
            greeting: msg.greeting,
            warm: msg.warm,
            userName: msg.userName,
            morningBrief: msg.morningBrief,
          });
          return;
        }

        if (msg.type === "greeting") {
          this.greetingHandler?.(msg.text);
          return;
        }

        if (msg.type === "brief_chunk" && this.morningBriefHandler?.onChunk) {
          this.morningBriefHandler.onChunk(msg.text);
          return;
        }

        if (msg.type === "brief" && this.morningBriefHandler) {
          this.morningBriefHandler.onBrief(msg.text);
          return;
        }

        if (msg.type === "chunk" && this.activeHandlers) {
          this.activeHandlers.onChunk(msg.text);
          return;
        }

        if (msg.type === "done" && this.activeHandlers) {
          this.activeHandlers.onDone(msg.reply, msg.context);
          this.activeHandlers = undefined;
          return;
        }

        if (msg.type === "cancelled" && this.activeHandlers) {
          this.activeHandlers.onCancelled(msg.reply);
          this.activeHandlers = undefined;
          return;
        }

        if (msg.type === "error") {
          if (this.activeHandlers) {
            this.activeHandlers.onError(msg.error);
            this.activeHandlers = undefined;
          } else {
            clearTimeout(timeout);
            reject(new Error(msg.error));
          }
          return;
        }

        if (msg.type === "learned" && this.learnHandler) {
          this.learnHandler(msg);
        }
      });

      ws.once("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      ws.once("close", () => {
        if (this.activeHandlers) {
          this.activeHandlers.onError("connection closed");
          this.activeHandlers = undefined;
        }
      });
    });
  }

  onLearned(handler: LearnHandler): void {
    this.learnHandler = handler;
  }

  onGreeting(handler: GreetingHandler): void {
    this.greetingHandler = handler;
  }

  onMorningBrief(handler: MorningBriefHandler): void {
    this.morningBriefHandler = handler;
  }

  sendChat(message: string, handlers: ChatHandlers): string {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("not connected");
    }
    if (this.activeHandlers) {
      throw new Error("a chat turn is already in progress");
    }

    const id = String(++this.chatId);
    this.activeHandlers = handlers;
    this.ws.send(JSON.stringify({ type: "chat", id, message }));
    return id;
  }

  cancel(id: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ws.send(JSON.stringify({ type: "cancel", id }));
  }

  close(): void {
    this.ws?.close();
    this.ws = undefined;
  }

  get busy(): boolean {
    return this.activeHandlers !== undefined;
  }
}
