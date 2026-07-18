import http, { type IncomingMessage } from "node:http";

import { WebSocketServer, type WebSocket } from "ws";

import { enqueueAgentWork } from "./agent-queue.js";
import { getAgent, resetAgentSession } from "./agent-manager.js";
import type { AriaAgent } from "./agent.js";
import { handleChatTurn } from "./chat.js";
import { getMcpServerNames } from "./config/mcp.js";
import { buildCursorStatus } from "./cursor-status.js";
import { isChatCancelled } from "./errors.js";
import { curatorStatus, runCurator } from "./learn/curator.js";
import { memoryUsage } from "./learn/memory-store.js";
import { onLearnNotification } from "./learn/notify.js";
import {
  approveAllPending,
  approvePending,
  isLearnApprovalRequired,
  loadPending,
  rejectAllPending,
  rejectPending,
} from "./learn/pending.js";
import { learnReviewEnabled } from "./learn/review.js";
import { buildContextStatus } from "./context-status.js";
import { personaStatus, userCallName } from "./persona.js";
import { skillsStatus } from "./skills/index.js";
import { fleetStatus, getFleetBridge, listAgentsForApi } from "./fleet/index.js";
import { cancelActiveRun } from "./runs.js";
import {
  deliverMorningBriefIfDue,
  isMorningBriefInFlight,
  morningBriefStatus,
} from "./morning-brief.js";
import {
  getLastHeartbeat,
  listJobStates,
  reloadScheduler,
  schedulerStatus,
  triggerJob,
} from "./scheduler/index.js";
import { getTtsEngine, getVoiceStatus, setVoiceEnabled, speak, toggleVoice, warmVoice } from "./tts.js";
import { buildGreetingSpeech } from "./spoken.js";
import { getGreeting, isWarm, onGreetingReady } from "./warmup.js";

type Inbound =
  | { type: "chat"; id?: string; message?: string }
  | { type: "cancel"; id?: string }
  | { type: "ping" };

type Outbound =
  | { type: "ready"; greeting?: string; warm?: boolean; sessionId?: string; userName?: string; morningBrief?: "pending" | "skip" }
  | { type: "greeting"; text: string }
  | { type: "brief"; text: string }
  | { type: "brief_chunk"; text: string }
  | { type: "pong" }
  | { type: "chunk"; id: string; text: string }
  | { type: "done"; id: string; reply: string; context?: ReturnType<typeof buildContextStatus> }
  | { type: "cancelled"; id: string; reply?: string }
  | { type: "error"; id?: string; error: string }
  | {
      type: "learned";
      target: "memory" | "user" | "skill";
      preview: string;
      staged?: boolean;
      pendingId?: string;
    };

function wsHost(): string {
  return process.env.AARIA_WS_HOST?.trim() || "127.0.0.1";
}

function wsPort(): number {
  const raw = process.env.AARIA_WS_PORT?.trim() || "8788";
  const port = Number.parseInt(raw, 10);
  return Number.isFinite(port) && port > 0 && port < 65536 ? port : 8788;
}

function send(ws: WebSocket, msg: Outbound): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function jsonResponse(
  res: import("node:http").ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(payload);
}

function sseWrite(res: import("node:http").ServerResponse, data: unknown): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export async function startServer(agent: AriaAgent): Promise<void> {
  const host = wsHost();
  const port = wsPort();
  const currentAgent = () => getAgent();

  const httpServer = http.createServer((req, res) => {
    void (async () => {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        });
        res.end();
        return;
      }

      if (req.method === "GET" && req.url === "/health") {
        const persona = personaStatus();
        const greeting = getGreeting();
        const mcpServers = getMcpServerNames();
        const mem = memoryUsage();
        const jobs = schedulerStatus();
        const brief = morningBriefStatus();
        const curator = curatorStatus();
        const skills = skillsStatus();
        jsonResponse(res, 200, {
          ok: true,
          name: "ARIA",
          version: "0.1.0",
          sessionId: currentAgent().agentId,
          warm: isWarm(),
          greeting,
          persona: Boolean(persona.soulPath),
          userProfile: Boolean(persona.userPath),
          memory: Boolean(persona.memoryPath),
          user: userCallName(),
          learn: {
            review: learnReviewEnabled(),
            model: process.env.AARIA_LEARN_MODEL?.trim() || "default",
            curator,
          },
          memoryStats: persona.memoryPath
            ? { entries: mem.entries, chars: mem.chars, limit: mem.limit }
            : undefined,
          context: buildContextStatus(),
          skills,
          mcp: {
            loaded: mcpServers.length > 0,
            servers: mcpServers,
          },
          scheduler: {
            enabled: jobs.enabled,
            started: jobs.started,
            configPath: jobs.configPath,
            jobCount: jobs.jobCount,
            lastHeartbeat: jobs.lastHeartbeat,
          },
          morningBrief: brief,
          voice: getVoiceStatus(),
        });
        return;
      }

      if (req.method === "GET" && req.url === "/cursor") {
        const status = await buildCursorStatus(currentAgent().agentId);
        jsonResponse(res, 200, status);
        return;
      }

      if (req.method === "GET" && req.url === "/heartbeat") {
        const snapshot = getLastHeartbeat();
        jsonResponse(res, 200, {
          ok: true,
          snapshot: snapshot ?? null,
          scheduler: schedulerStatus(),
        });
        return;
      }

      if (req.method === "GET" && req.url === "/jobs") {
        jsonResponse(res, 200, {
          ok: true,
          scheduler: schedulerStatus(),
          jobs: listJobStates(),
        });
        return;
      }

      if (req.method === "POST" && req.url === "/jobs/reload") {
        const result = reloadScheduler();
        if (!result.ok) {
          jsonResponse(res, 503, { ok: false, error: result.error });
          return;
        }
        jsonResponse(res, 200, {
          ok: true,
          count: result.count,
          jobs: listJobStates(),
        });
        return;
      }

      if (req.method === "POST" && req.url === "/jobs/run") {
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          jsonResponse(res, 400, { error: "invalid JSON body" });
          return;
        }
        const id = (body as { id?: string }).id?.trim() ?? "";
        if (!id) {
          jsonResponse(res, 400, { error: "id is required" });
          return;
        }
        const result = await triggerJob(id);
        if (!result.ok) {
          jsonResponse(res, 404, { ok: false, error: result.error });
          return;
        }
        jsonResponse(res, 200, {
          ok: true,
          id,
          result: result.result,
          job: listJobStates().find((j) => j.id === id),
        });
        return;
      }

      if (req.method === "GET" && req.url === "/memory/pending") {
        const pending = loadPending();
        jsonResponse(res, 200, {
          ok: true,
          approvalRequired: isLearnApprovalRequired(),
          pending,
        });
        return;
      }

      if (req.method === "POST" && req.url === "/memory/approve") {
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          jsonResponse(res, 400, { error: "invalid JSON body" });
          return;
        }
        const id = (body as { id?: string }).id?.trim() ?? "";
        if (!id || id === "all") {
          const result = approveAllPending();
          jsonResponse(res, 200, { ok: true, ...result });
          return;
        }
        const result = approvePending(id);
        if (!result.ok) {
          jsonResponse(res, 404, { ok: false, error: result.error });
          return;
        }
        jsonResponse(res, 200, { ok: true, target: result.target, preview: result.preview, id });
        return;
      }

      if (req.method === "POST" && req.url === "/memory/reject") {
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          jsonResponse(res, 400, { error: "invalid JSON body" });
          return;
        }
        const id = (body as { id?: string }).id?.trim() ?? "";
        if (!id || id === "all") {
          const count = rejectAllPending();
          jsonResponse(res, 200, { ok: true, rejected: count });
          return;
        }
        const rejected = rejectPending(id);
        if (!rejected) {
          jsonResponse(res, 404, { ok: false, error: `no pending entry ${id}` });
          return;
        }
        jsonResponse(res, 200, { ok: true, id });
        return;
      }

      if (req.method === "POST" && req.url === "/memory/curate") {
        try {
          const result = await enqueueAgentWork(() => runCurator());
          if (!result.ok) {
            jsonResponse(res, 500, { ok: false, error: result.error });
            return;
          }
          jsonResponse(res, 200, result);
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          jsonResponse(res, 500, { ok: false, error });
        }
        return;
      }

      if (req.method === "GET" && req.url === "/skills") {
        jsonResponse(res, 200, { ok: true, skills: skillsStatus() });
        return;
      }

      if (req.method === "GET" && req.url === "/fleet/health") {
        jsonResponse(res, 200, { ok: true, ...fleetStatus() });
        return;
      }

      if (req.method === "GET" && req.url === "/fleet/agents") {
        const agents = await listAgentsForApi();
        jsonResponse(res, 200, { ok: true, ...fleetStatus(), agents });
        return;
      }

      if (req.method === "POST" && req.url === "/fleet/approve") {
        const bridge = getFleetBridge();
        if (!bridge) {
          jsonResponse(res, 503, { ok: false, error: "fleet disabled" });
          return;
        }
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          jsonResponse(res, 400, { error: "invalid JSON body" });
          return;
        }
        const agentId = (body as { agentId?: string }).agentId?.trim() ?? "";
        if (!agentId) {
          jsonResponse(res, 400, { error: "agentId is required" });
          return;
        }
        const labels = (body as { labels?: Record<string, string> }).labels;
        const caps = (body as { caps?: string[] }).caps;
        try {
          const agent = await bridge.approve(agentId, labels, caps);
          jsonResponse(res, 200, { ok: true, agent });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          jsonResponse(res, 500, { ok: false, error });
        }
        return;
      }

      if (req.method === "POST" && req.url === "/fleet/cmd") {
        const bridge = getFleetBridge();
        if (!bridge) {
          jsonResponse(res, 503, { ok: false, error: "fleet disabled" });
          return;
        }
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          jsonResponse(res, 400, { error: "invalid JSON body" });
          return;
        }
        const agentId = (body as { agentId?: string }).agentId?.trim() ?? "";
        const action = (body as { action?: string }).action?.trim() ?? "";
        const args = (body as { args?: Record<string, unknown> }).args ?? {};
        if (!agentId || !action) {
          jsonResponse(res, 400, {
            error: "agentId and action are required",
          });
          return;
        }
        try {
          const result = await bridge.dispatchCmd(agentId, action, args);
          jsonResponse(res, 200, { ok: true, ...result });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          jsonResponse(res, 400, { ok: false, error });
        }
        return;
      }

      if (req.method === "GET" && req.url === "/voice") {
        jsonResponse(res, 200, { ok: true, ...getVoiceStatus() });
        return;
      }

      if (req.method === "POST" && req.url === "/voice") {
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          jsonResponse(res, 400, { error: "invalid JSON body" });
          return;
        }
        const raw = (body as { enabled?: unknown; action?: string }).enabled;
        const action = (body as { action?: string }).action?.trim().toLowerCase();
        let status;
        if (action === "toggle" || (raw === undefined && !action)) {
          status = toggleVoice();
        } else if (
          raw === true ||
          raw === 1 ||
          raw === "1" ||
          raw === "on" ||
          raw === "true" ||
          action === "on"
        ) {
          status = setVoiceEnabled(true);
        } else if (
          raw === false ||
          raw === 0 ||
          raw === "0" ||
          raw === "off" ||
          raw === "false" ||
          action === "off"
        ) {
          status = setVoiceEnabled(false);
        } else {
          jsonResponse(res, 400, {
            ok: false,
            error: "pass enabled:true|false or action:on|off|toggle",
          });
          return;
        }
        jsonResponse(res, 200, { ok: true, ...status });
        return;
      }

      if (
        (req.method === "POST" || req.method === "GET") &&
        (req.url === "/voice/warmup" || req.url?.startsWith("/voice/warmup?"))
      ) {
        const force =
          req.url.includes("force=1") || req.url.includes("force=true");
        const result = await warmVoice(force);
        jsonResponse(res, 200, {
          ok: result.ok,
          engine: result.engine ?? getTtsEngine(),
          ms: result.ms,
          skipped: result.skipped ?? false,
        });
        return;
      }

      if (req.method === "POST" && req.url === "/voice/speak") {
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          jsonResponse(res, 400, { error: "invalid JSON body" });
          return;
        }
        const text = (body as { text?: string }).text?.trim() ?? "";
        const kind = (body as { kind?: string }).kind?.trim() || "raw";
        if (!text) {
          jsonResponse(res, 400, { error: "text is required" });
          return;
        }
        if (getTtsEngine() === "off") {
          jsonResponse(res, 200, { ok: false, spoken: false, engine: "off" });
          return;
        }
        const line =
          kind === "greeting" ? buildGreetingSpeech(text) : text;
        if (!line) {
          jsonResponse(res, 200, { ok: false, spoken: false, engine: getTtsEngine() });
          return;
        }
        speak(line);
        jsonResponse(res, 200, {
          ok: true,
          spoken: true,
          engine: getTtsEngine(),
          chars: line.length,
        });
        return;
      }

      if (req.method === "POST" && req.url === "/chat/cancel") {
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          jsonResponse(res, 400, { error: "invalid JSON body" });
          return;
        }
        const id = (body as { id?: string }).id?.trim() ?? "";
        if (!id) {
          jsonResponse(res, 400, { error: "id is required" });
          return;
        }
        const cancelled = await cancelActiveRun(id);
        jsonResponse(res, 200, { ok: true, cancelled, id });
        return;
      }

      if (req.method === "POST" && req.url === "/session/reset") {
        try {
          const previousId = currentAgent().agentId;
          const agent = await resetAgentSession();
          jsonResponse(res, 200, {
            ok: true,
            previousSessionId: previousId,
            sessionId: agent.agentId,
            warm: isWarm(),
            greeting: getGreeting(),
          });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          jsonResponse(res, 500, { ok: false, error });
        }
        return;
      }

      if (req.method === "POST" && req.url === "/chat/stream") {
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          jsonResponse(res, 400, { error: "invalid JSON body" });
          return;
        }
        const message = (body as { message?: string }).message?.trim() ?? "";
        const id = (body as { id?: string }).id?.trim() || "stream";
        if (!message) {
          jsonResponse(res, 400, { error: "message is required" });
          return;
        }

        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        });

        try {
          const reply = await enqueueAgentWork(() =>
            handleChatTurn(currentAgent(), "http-stream", id, message, (text) => {
              sseWrite(res, { type: "chunk", id, text });
            }),
          );
          sseWrite(res, { type: "done", id, reply, context: buildContextStatus() });
        } catch (err) {
          if (isChatCancelled(err)) {
            sseWrite(res, {
              type: "cancelled",
              id,
              reply: err.partialReply,
            });
          } else {
            const error = err instanceof Error ? err.message : String(err);
            sseWrite(res, { type: "error", id, error });
          }
        }
        res.end();
        return;
      }

      if (req.method === "POST" && req.url === "/chat") {
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          jsonResponse(res, 400, { error: "invalid JSON body" });
          return;
        }
        const message = (body as { message?: string }).message?.trim() ?? "";
        const id = (body as { id?: string }).id?.trim() || "http";
        if (!message) {
          jsonResponse(res, 400, { error: "message is required" });
          return;
        }
        try {
          const reply = await enqueueAgentWork(() =>
            handleChatTurn(currentAgent(), "http", id, message),
          );
          jsonResponse(res, 200, { reply, id });
        } catch (err) {
          if (isChatCancelled(err)) {
            jsonResponse(res, 200, {
              cancelled: true,
              id,
              reply: err.partialReply,
            });
            return;
          }
          const error = err instanceof Error ? err.message : String(err);
          jsonResponse(res, 500, { error });
        }
        return;
      }

      res.writeHead(404);
      res.end();
    })().catch((err) => {
      console.error("[aria-server]", err);
      if (!res.headersSent) {
        jsonResponse(res, 500, { error: "internal error" });
      }
    });
  });

  const wss = new WebSocketServer({ server: httpServer });

  function sendReady(ws: WebSocket): void {
    const brief = morningBriefStatus();
    send(ws, {
      type: "ready",
      warm: isWarm(),
      greeting: getGreeting(),
      sessionId: currentAgent().agentId,
      userName: userCallName(),
      morningBrief: brief.due ? "pending" : "skip",
    });
  }

  function scheduleMorningBrief(ws: WebSocket): void {
    const brief = morningBriefStatus();
    if (!brief.due && !isMorningBriefInFlight()) return;

    void deliverMorningBriefIfDue(agent, (text) => {
      for (const client of wss.clients) {
        send(client, { type: "brief_chunk", text });
      }
    }).then((reply) => {
      if (reply) {
        send(ws, { type: "brief", text: reply });
      }
    });
  }

  onGreetingReady((greeting) => {
    for (const client of wss.clients) {
      send(client, { type: "greeting", text: greeting });
    }
  });

  onLearnNotification((event) => {
    const msg: Outbound = { type: "learned", ...event };
    for (const client of wss.clients) {
      send(client, msg);
    }
  });

  wss.on("connection", (ws) => {
    sendReady(ws);
    scheduleMorningBrief(ws);

    ws.on("message", (raw) => {
      void (async () => {
        let parsed: Inbound;
        try {
          parsed = JSON.parse(String(raw)) as Inbound;
        } catch {
          send(ws, { type: "error", error: "invalid JSON" });
          return;
        }

        if (parsed.type === "ping") {
          send(ws, { type: "pong" });
          return;
        }

        if (parsed.type === "cancel") {
          const id = parsed.id?.trim() ?? "";
          if (!id) {
            send(ws, { type: "error", error: "id is required" });
            return;
          }
          const cancelled = await cancelActiveRun(id);
          if (!cancelled) {
            send(ws, { type: "error", id, error: "no active run for this id" });
          }
          return;
        }

        if (parsed.type !== "chat") {
          send(ws, { type: "error", error: "unknown message type" });
          return;
        }

        const id = parsed.id?.trim() || "1";
        const message = parsed.message?.trim() ?? "";
        if (!message) {
          send(ws, { type: "error", id, error: "message is required" });
          return;
        }

        try {
          const reply = await enqueueAgentWork(() =>
            handleChatTurn(currentAgent(), "ws", id, message, (text) => {
              send(ws, { type: "chunk", id, text });
            }),
          );
          send(ws, { type: "done", id, reply, context: buildContextStatus() });
        } catch (err) {
          if (isChatCancelled(err)) {
            send(ws, {
              type: "cancelled",
              id,
              reply: err.partialReply,
            });
          } else {
            const error = err instanceof Error ? err.message : String(err);
            send(ws, { type: "error", id, error });
          }
        }
      })();
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => resolve());
  });

  console.error(`[aria-server] ws://${host}:${port}`);
  console.error(`[aria-server] GET /health  GET /cursor  GET /heartbeat  GET /jobs  POST /jobs/run  POST /jobs/reload`);
  console.error(`[aria-server] GET /memory/pending  POST /memory/approve  POST /memory/reject  POST /memory/curate  GET /skills`);
  console.error(`[aria-server] GET /fleet/health  GET /fleet/agents  POST /fleet/approve  POST /fleet/cmd`);
  console.error(`[aria-server] POST /voice/warmup  POST /voice/speak  GET|POST /voice  POST /chat  POST /chat/cancel  POST /chat/stream`);
  console.error(`[aria-server] POST /session/reset`);

  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      wss.close();
      httpServer.close(() => resolve());
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}
