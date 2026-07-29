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
export type ConnectionState = "connected" | "reconnecting" | "disconnected";
export type ConnectionHandler = (state: ConnectionState, detail?: string) => void;

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 15_000;

export class AriaWsClient {
  private ws: WebSocket | undefined;
  private chatId = 0;
  private activeHandlers: ChatHandlers | undefined;
  private learnHandler: LearnHandler | undefined;
  private morningBriefHandler: MorningBriefHandler | undefined;
  private greetingHandler: GreetingHandler | undefined;
  private connectionHandler: ConnectionHandler | undefined;
  private intentionalClose = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private everConnected = false;
  private connectPromise: Promise<void> | undefined;

  async connect(): Promise<{
    greeting?: string;
    warm?: boolean;
    userName?: string;
    morningBrief?: "pending" | "skip";
  }> {
    this.intentionalClose = false;
    return this.openSocket({ waitForReady: true });
  }

  private openSocket(opts: {
    waitForReady: true;
  }): Promise<{
    greeting?: string;
    warm?: boolean;
    userName?: string;
    morningBrief?: "pending" | "skip";
  }>;
  private openSocket(opts: { waitForReady: false }): Promise<void>;
  private openSocket(opts: { waitForReady: boolean }): Promise<
    | {
        greeting?: string;
        warm?: boolean;
        userName?: string;
        morningBrief?: "pending" | "skip";
      }
    | void
  > {
    if (this.connectPromise && !opts.waitForReady) {
      return this.connectPromise;
    }

    const url = wsUrl();
    const promise = new Promise<{
      greeting?: string;
      warm?: boolean;
      userName?: string;
      morningBrief?: "pending" | "skip";
    }>((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
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
          this.reconnectAttempt = 0;
          this.everConnected = true;
          this.connectionHandler?.("connected");
          if (!settled) {
            settled = true;
            resolve({
              greeting: msg.greeting,
              warm: msg.warm,
              userName: msg.userName,
              morningBrief: msg.morningBrief,
            });
          }
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
          } else if (!settled) {
            clearTimeout(timeout);
            settled = true;
            reject(new Error(msg.error));
          }
          return;
        }

        if (msg.type === "learned" && this.learnHandler) {
          this.learnHandler(msg);
        }
      });

      ws.once("error", (err) => {
        if (!settled && opts.waitForReady) {
          clearTimeout(timeout);
          settled = true;
          reject(err);
        }
      });

      ws.once("close", () => {
        clearTimeout(timeout);
        if (this.ws === ws) {
          this.ws = undefined;
        }
        if (this.activeHandlers) {
          this.activeHandlers.onError("connection closed");
          this.activeHandlers = undefined;
        }
        if (!settled && opts.waitForReady) {
          settled = true;
          reject(new Error("connection closed before ready"));
          return;
        }
        // Only auto-reconnect after an initial successful ready handshake.
        if (!this.intentionalClose && this.everConnected) {
          this.scheduleReconnect();
        } else if (this.intentionalClose) {
          this.connectionHandler?.("disconnected");
        }
      });
    });

    if (!opts.waitForReady) {
      this.connectPromise = promise.then(
        () => undefined,
        () => undefined,
      );
      return this.connectPromise;
    }

    return promise;
  }

  private scheduleReconnect(): void {
    if (this.intentionalClose || this.reconnectTimer) {
      return;
    }
    const attempt = this.reconnectAttempt++;
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** Math.min(attempt, 5),
      RECONNECT_MAX_MS,
    );
    this.connectionHandler?.(
      "reconnecting",
      `attempt ${attempt + 1} in ${Math.round(delay / 1000)}s`,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.intentionalClose) {
        return;
      }
      void this.openSocket({ waitForReady: false }).catch(() => {
        // close handler will schedule the next attempt
      });
    }, delay);
  }

  onConnection(handler: ConnectionHandler): void {
    this.connectionHandler = handler;
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

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Wait briefly for an in-flight reconnect before sending. */
  async ensureConnected(timeoutMs = 8_000): Promise<void> {
    if (this.connected) {
      return;
    }
    if (this.intentionalClose) {
      throw new Error("not connected");
    }
    if (!this.everConnected) {
      throw new Error("not connected");
    }
    this.scheduleReconnect();
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (this.connected) {
        return;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error("not connected (reconnect timed out)");
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
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.ws?.close();
    this.ws = undefined;
  }

  get busy(): boolean {
    return this.activeHandlers !== undefined;
  }
}
