import WebSocket from "ws";

import { wsUrl } from "./config.js";

type Outbound =
  | { type: "ready"; greeting?: string; warm?: boolean; sessionId?: string; userName?: string }
  | { type: "greeting"; text: string }
  | { type: "pong" }
  | { type: "chunk"; id: string; text: string }
  | { type: "done"; id: string; reply: string }
  | { type: "cancelled"; id: string; reply?: string }
  | { type: "error"; id?: string; error: string }
  | {
      type: "learned";
      target: "memory" | "user";
      preview: string;
      staged?: boolean;
      pendingId?: string;
    };

export type LearnedEvent = Extract<Outbound, { type: "learned" }>;

export type ChatHandlers = {
  onChunk: (text: string) => void;
  onDone: (reply: string) => void;
  onCancelled: (partial?: string) => void;
  onError: (message: string) => void;
};

export type LearnHandler = (event: LearnedEvent) => void;

export class AriaWsClient {
  private ws: WebSocket | undefined;
  private chatId = 0;
  private activeHandlers: ChatHandlers | undefined;
  private learnHandler: LearnHandler | undefined;

  async connect(): Promise<{ greeting?: string; warm?: boolean; userName?: string }> {
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
          resolve({ greeting: msg.greeting, warm: msg.warm, userName: msg.userName });
          return;
        }

        if (msg.type === "greeting") {
          return;
        }

        if (msg.type === "chunk" && this.activeHandlers) {
          this.activeHandlers.onChunk(msg.text);
          return;
        }

        if (msg.type === "done" && this.activeHandlers) {
          this.activeHandlers.onDone(msg.reply);
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
