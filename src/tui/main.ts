#!/usr/bin/env node
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { ensureServerReady, fetchHealth, systemdServiceName, type Health } from "./bootstrap.js";
import { AriaWsClient } from "./client.js";
import {
  completeLine,
  looksLikeCommand,
  matchCommands,
  SLASH_COMMANDS,
} from "./commands.js";
import { apiBase } from "./config.js";
import { BootLoader } from "./loader.js";
import { Spinner } from "./spinner.js";
import { agentPrefix, brandLine, c, formalTitleLine, userPrefix } from "./theme.js";

function commandHelpLines(): string {
  return SLASH_COMMANDS.map(
    (cmd) => `  ${cmd.name.padEnd(10)}${cmd.summary}`,
  ).join("\n");
}

function printHelp(): void {
  output.write(`
${formalTitleLine()}

${c.bold}Commands${c.reset}
${commandHelpLines()}

${c.dim}Type / for command suggestions · Tab to complete.
Talk naturally for work tasks — code, DevOps, servers, planning.
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
  const loader = new BootLoader();
  loader.start();

  let health: Health;
  let startedService = false;
  try {
    const ready = await ensureServerReady({
      onStarting: () => loader.setPhase(`booting ${systemdServiceName()}`),
      onWaiting: () => loader.setPhase("warming systems"),
    });
    health = ready.health;
    startedService = ready.startedService;
  } catch (err) {
    loader.stop();
    const msg = err instanceof Error ? err.message : String(err);
    output.write(`${c.err}ARIA API unreachable at ${apiBase()}${c.reset}\n`);
    output.write(`${c.dim}${msg}${c.reset}\n`);
    process.exit(1);
  }

  if (!health.ok) {
    loader.stop();
    output.write(`${c.err}ARIA API reported not ok${c.reset}\n`);
    process.exit(1);
  }

  const client = new AriaWsClient();
  let userName: string | undefined;
  try {
    loader.setPhase("establishing uplink");
    const ready = await client.connect();
    userName = ready.userName || health.user;
    loader.stop();
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
    loader.stop();
    const msg = err instanceof Error ? err.message : String(err);
    output.write(`${c.err}WebSocket connect failed: ${msg}${c.reset}\n`);
    process.exit(1);
  }

  const rl = readline.createInterface({
    input,
    output,
    terminal: true,
    completer: completeLine,
  });
  let closed = false;
  let currentChatId: string | undefined;
  let streaming = false;
  let activeSpinner: Spinner | undefined;

  const interactive = Boolean(input.isTTY && output.isTTY);
  let hintVisible = false;

  // While the agent is working we detach readline's key handling so keystrokes
  // are not echoed into the agent's output and stray Enters don't redraw the
  // `you ›` prompt mid-reply. Only Ctrl+C is honoured (to cancel). Readline's
  // own listeners are restored verbatim when the turn ends.
  let inputSuspended = false;
  let savedKeypressListeners: ((...args: unknown[]) => void)[] = [];

  const streamKeypress = (_str: string | undefined, key: { name?: string; ctrl?: boolean } | undefined): void => {
    if (key?.ctrl && key.name === "c") {
      if (currentChatId) {
        output.write(`\n${c.dim}cancelling…${c.reset}\n`);
        client.cancel(currentChatId);
      }
    }
    // Every other key is intentionally swallowed while the agent is working.
  };

  const suspendInput = (): void => {
    if (!interactive || inputSuspended) {
      return;
    }
    inputSuspended = true;
    savedKeypressListeners = input.listeners("keypress") as typeof savedKeypressListeners;
    input.removeAllListeners("keypress");
    input.on("keypress", streamKeypress);
  };

  const resumeInput = (): void => {
    if (!inputSuspended) {
      return;
    }
    inputSuspended = false;
    input.removeListener("keypress", streamKeypress);
    for (const listener of savedKeypressListeners) {
      input.on("keypress", listener);
    }
    savedKeypressListeners = [];
  };

  // Render a dim suggestion line just below the prompt while typing a command.
  // Uses DEC save/restore cursor so the input line is never disturbed.
  const clearHint = (): void => {
    if (!hintVisible) {
      return;
    }
    output.write("\x1b7\n\x1b[2K\x1b8");
    hintVisible = false;
  };

  const renderHint = (): void => {
    if (!interactive || streaming) {
      return;
    }
    const line = rl.line ?? "";
    if (!line.startsWith("/") || line.includes(" ")) {
      clearHint();
      return;
    }
    const matches = matchCommands(line);
    if (matches.length === 0) {
      clearHint();
      return;
    }
    const text =
      matches.length === 1
        ? `${matches[0].name} — ${matches[0].summary}`
        : matches.map((cmd) => cmd.name).join("  ");
    output.write(`\x1b7\n\x1b[2K${c.dim}${text}${c.reset}\x1b8`);
    hintVisible = true;
  };

  if (interactive) {
    // Runs before readline's own handler: clear the hint on Enter so it does
    // not linger on the submitted line; otherwise refresh after the keystroke.
    input.prependListener("keypress", (_str, key) => {
      if (key && (key.name === "return" || key.name === "enter")) {
        clearHint();
        return;
      }
      setImmediate(renderHint);
    });
  }

  const prompt = (): void => {
    if (!closed) {
      rl.prompt();
    }
  };

  const finishTurn = (): void => {
    activeSpinner?.stop();
    activeSpinner = undefined;
    streaming = false;
    currentChatId = undefined;
    resumeInput();
    output.write("\n\n");
    prompt();
  };

  rl.setPrompt(userPrefix(userName));

  rl.on("SIGINT", () => {
    clearHint();
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
      clearHint();
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

      if (looksLikeCommand(text)) {
        const matches = matchCommands(text.toLowerCase());
        const suggestion =
          matches.length > 0
            ? ` Did you mean ${matches.map((cmd) => cmd.name).join(", ")}?`
            : " Type /help for commands.";
        output.write(`${c.warn}unknown command ${text}.${c.reset}${c.dim}${suggestion}${c.reset}\n\n`);
        prompt();
        return;
      }

      if (streaming) {
        output.write(`${c.warn}wait for the current reply or /cancel${c.reset}\n`);
        prompt();
        return;
      }

      streaming = true;
      suspendInput();

      // Show a "working" indicator until the first token lands; then hand the
      // line over to the streamed reply.
      let firstChunk = true;
      output.write("\n");
      const spinner = new Spinner(
        (frame) => `${agentPrefix()}${c.dim}${frame} working… ${c.reset}${c.dim}(Ctrl+C to cancel)${c.reset}`,
      );
      activeSpinner = spinner;
      spinner.start();

      const openAgentLine = (): void => {
        if (firstChunk) {
          firstChunk = false;
          spinner.stop();
          output.write(agentPrefix());
        }
      };

      try {
        currentChatId = client.sendChat(text, {
          onChunk: (chunk) => {
            openAgentLine();
            output.write(chunk);
          },
          onDone: () => {
            if (firstChunk) {
              spinner.stop();
              output.write(`${agentPrefix()}${c.dim}(no reply)${c.reset}`);
              firstChunk = false;
            }
            finishTurn();
          },
          onCancelled: (partial) => {
            openAgentLine();
            output.write(`\n${c.dim}${partial ? "(cancelled)" : "cancelled"}${c.reset}`);
            finishTurn();
          },
          onError: (message) => {
            openAgentLine();
            output.write(`\n${c.err}${message}${c.reset}`);
            finishTurn();
          },
        });
      } catch (err) {
        spinner.stop();
        activeSpinner = undefined;
        streaming = false;
        currentChatId = undefined;
        resumeInput();
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

  // Never leave the terminal cursor hidden if we exit mid-spinner.
  process.on("exit", () => {
    if (output.isTTY) {
      output.write("\x1b[?25h");
    }
  });

  printHelp();
  prompt();
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  output.write(`${c.err}${msg}${c.reset}\n`);
  process.exit(1);
});
