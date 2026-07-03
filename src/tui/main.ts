#!/usr/bin/env node
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { ensureServerReady, fetchHealth, systemdServiceName, type Health } from "./bootstrap.js";
import { AriaWsClient } from "./client.js";
import { apiBase } from "./config.js";
import { agentPrefix, brandLine, c, userPrefix } from "./theme.js";

function printHelp(): void {
  output.write(`
${brandLine("ARIA")} ${c.dim}— Augmented Adaptive Reasoning Intelligence Assistant${c.reset}

${c.bold}Commands${c.reset}
  /help     Show this help
  /health   Backend status
  /cancel   Cancel the current reply
  /quit     Exit (${c.dim}also /exit, Ctrl+D${c.reset})

${c.dim}Talk naturally for work tasks — code, DevOps, servers, planning.
Home and Home Assistant → Amelia.${c.reset}

`);
}

function printBanner(health: Health): void {
  output.write("\n");
  output.write(`${brandLine(" AARIA ")} ${c.dim}work desk · ${apiBase()}${c.reset}\n`);
  if (health.version) {
    output.write(`${c.dim}v${health.version}${health.sessionId ? ` · session ${health.sessionId.slice(0, 12)}…` : ""}${c.reset}\n`);
  }
  output.write("\n");
}

async function main(): Promise<void> {
  let health: Health;
  let startedService = false;
  try {
    const ready = await ensureServerReady({
      onStarting: () => {
        output.write(`${c.dim}starting ${systemdServiceName()}…${c.reset}\n`);
      },
      onWaiting: () => {
        output.write(`${c.dim}waiting for ARIA API…${c.reset}\n`);
      },
    });
    health = ready.health;
    startedService = ready.startedService;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    output.write(`${c.err}ARIA API unreachable at ${apiBase()}${c.reset}\n`);
    output.write(`${c.dim}${msg}${c.reset}\n`);
    process.exit(1);
  }

  if (!health.ok) {
    output.write(`${c.err}ARIA API reported not ok${c.reset}\n`);
    process.exit(1);
  }

  const client = new AriaWsClient();
  try {
    const ready = await client.connect();
    printBanner(health);
    if (startedService) {
      output.write(`${c.dim}started aria-api.service${c.reset}\n`);
    }
    const greeting = ready.greeting || health.greeting;
    if (greeting?.trim()) {
      output.write(`${agentPrefix()}${greeting.trim()}\n\n`);
    } else if (!health.warm) {
      output.write(`${c.dim}Warming up…${c.reset}\n\n`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    output.write(`${c.err}WebSocket connect failed: ${msg}${c.reset}\n`);
    process.exit(1);
  }

  const rl = readline.createInterface({ input, output, terminal: true });
  let closed = false;
  let currentChatId: string | undefined;
  let streaming = false;

  const prompt = (): void => {
    if (!closed) {
      rl.prompt();
    }
  };

  const finishTurn = (): void => {
    streaming = false;
    currentChatId = undefined;
    output.write("\n\n");
    prompt();
  };

  rl.setPrompt(userPrefix());

  rl.on("SIGINT", () => {
    if (streaming && currentChatId) {
      output.write(`\n${c.dim}cancelling…${c.reset}\n`);
      client.cancel(currentChatId);
      return;
    }
    output.write(`\n${c.dim}bye${c.reset}\n`);
    closed = true;
    client.close();
    rl.close();
  });

  rl.on("line", (line) => {
    void (async () => {
      const text = line.trim();
      if (!text) {
        prompt();
        return;
      }

      const lower = text.toLowerCase();
      if (lower === "/quit" || lower === "/exit") {
        output.write(`${c.dim}bye${c.reset}\n`);
        closed = true;
        client.close();
        rl.close();
        return;
      }

      if (lower === "/help") {
        printHelp();
        prompt();
        return;
      }

      if (lower === "/health") {
        try {
          const h = await fetchHealth();
          output.write(
            `${c.ok}ok${c.reset} warm=${h.warm ? "yes" : "no"} persona=${h.persona ? "yes" : "no"} mcp=${h.mcp?.loaded ? h.mcp.servers.join(", ") : "off"}\n\n`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          output.write(`${c.err}${msg}${c.reset}\n\n`);
        }
        prompt();
        return;
      }

      if (lower === "/cancel") {
        if (streaming && currentChatId) {
          client.cancel(currentChatId);
          output.write(`${c.dim}cancel requested${c.reset}\n`);
        } else {
          output.write(`${c.dim}nothing to cancel${c.reset}\n\n`);
          prompt();
        }
        return;
      }

      if (streaming) {
        output.write(`${c.warn}wait for the current reply or /cancel${c.reset}\n`);
        prompt();
        return;
      }

      streaming = true;
      output.write(`\n${agentPrefix()}`);

      try {
        currentChatId = client.sendChat(text, {
          onChunk: (chunk) => {
            output.write(chunk);
          },
          onDone: () => {
            finishTurn();
          },
          onCancelled: (partial) => {
            output.write(`\n${c.dim}${partial ? "(cancelled)" : "cancelled"}${c.reset}`);
            finishTurn();
          },
          onError: (message) => {
            output.write(`\n${c.err}${message}${c.reset}`);
            finishTurn();
          },
        });
      } catch (err) {
        streaming = false;
        currentChatId = undefined;
        const msg = err instanceof Error ? err.message : String(err);
        output.write(`${c.err}${msg}${c.reset}\n\n`);
        prompt();
      }
    })();
  });

  rl.on("close", () => {
    client.close();
    process.exit(0);
  });

  printHelp();
  prompt();
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  output.write(`${c.err}${msg}${c.reset}\n`);
  process.exit(1);
});
