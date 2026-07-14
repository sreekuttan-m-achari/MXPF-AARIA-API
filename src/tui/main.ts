#!/usr/bin/env node
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { ensureServerReady, fetchHealth, systemdServiceName, type Health } from "./bootstrap.js";
import { AriaWsClient } from "./client.js";
import {
  completeLine,
  isBuiltinCommand,
  isMemoryCommand,
  isBareSkillCommand,
  isSkillsCommand,
  looksLikeCommand,
  matchCommands,
  SLASH_COMMANDS,
} from "./commands.js";
import { TurnActivity } from "./activity.js";
import { apiBase } from "./config.js";
import { BootLoader } from "./loader.js";
import { createPasteAwareInput, flushStdin } from "./paste-input.js";
import { opsEnabled, pushChatHistory, runOpsMode } from "./ops/index.js";
import { agentPrefix, ariaWordmark, c, formalTitleLine, learnTargetStyle, userPrefix } from "./theme.js";
import { colorizeCommandLine, colorizeReplyChunk } from "./render.js";

function commandHelpLines(): string {
  return SLASH_COMMANDS.map((cmd) =>
    colorizeCommandLine(cmd.name, cmd.summary),
  ).join("\n");
}

function printHelp(): void {
  output.write(`
${formalTitleLine()}

${c.gold}${c.bold}Commands${c.reset}
${commandHelpLines()}

${c.dim}Type ${c.cmd}/${c.reset}${c.dim} for command suggestions · Tab to complete.
Paste multiple lines as one message · end a line with \\ to continue on the next.
${c.cmd}/ops${c.reset}${c.dim} or ${c.cmd}Ctrl+O${c.reset}${c.dim} opens the ops overlay (set ${c.cmd}AARIA_OPS=0${c.reset}${c.dim} to disable).
Talk naturally for work tasks — code, DevOps, servers, planning.
${c.accent}Home and Home Assistant${c.reset}${c.dim} → Amelia.${c.reset}

`);
}

function printBanner(health: Health): void {
  output.write("\n");
  output.write(` ${ariaWordmark()} ${c.dim}work desk · ${c.teal}${apiBase()}${c.reset}\n`);
  if (health.version) {
    output.write(
      `${c.dim}v${health.version}${health.sessionId ? ` · session ${c.plum}${health.sessionId.slice(0, 12)}…${c.reset}${c.dim}` : ""}${c.reset}\n`,
    );
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
  let briefStreaming = false;

  client.onMorningBrief({
    onChunk: (text) => {
      if (!briefStreaming) {
        briefStreaming = true;
        output.write(`\n${agentPrefix()}${c.gold}${c.bold}Morning brief${c.reset}\n`);
      }
      output.write(colorizeReplyChunk(text));
    },
    onBrief: (text) => {
      if (!briefStreaming) {
        output.write(`\n${agentPrefix()}${c.gold}${c.bold}Morning brief${c.reset}\n${colorizeReplyChunk(text.trim())}\n\n`);
      } else {
        output.write("\n\n");
      }
      briefStreaming = false;
      if (!streaming) {
        prompt();
      }
    },
  });

  client.onLearned((event) => {
    if (closed) {
      return;
    }
    const style = learnTargetStyle(event.target);
    const label = event.staged ? `${c.warn}staged${c.reset}` : `${c.ok}learned${c.reset}`;
    const id = event.pendingId ? ` ${c.dim}· ${event.pendingId}${c.reset}` : "";
    output.write(
      `\n${c.gold}💾${c.reset} ${label} ${c.dim}→${c.reset} ${style.color}${style.label}${c.reset}${id}: ${c.text}${event.preview}${c.reset}\n`,
    );
    if (!streaming) {
      prompt();
    }
  });
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
      output.write(`${agentPrefix()}${colorizeReplyChunk(greeting.trim())}\n\n`);
    } else if (!health.warm) {
      output.write(`${c.gold}◌${c.reset} ${c.dim}Warming up…${c.reset}\n\n`);
    }
    if (ready.morningBrief === "pending") {
      output.write(`${c.dim}Preparing ${c.gold}morning brief${c.reset}${c.dim}…${c.reset}\n\n`);
    }
  } catch (err) {
    loader.stop();
    const msg = err instanceof Error ? err.message : String(err);
    output.write(`${c.err}WebSocket connect failed: ${msg}${c.reset}\n`);
    process.exit(1);
  }

  const interactive = Boolean(input.isTTY && output.isTTY);

  let dispatchInput: ((text: string) => void) | undefined;
  /** Assigned after helpers are defined; paste/SIGINT paths call through this. */
  let handleInterrupt = (): void => {};

  const readlineInput = interactive
    ? createPasteAwareInput(input, output, {
        onPaste: (text) => {
          const trimmed = text.trim();
          if (!trimmed) {
            return;
          }
          // Slash commands should run immediately, not enter paste-draft mode.
          if (!trimmed.includes("\n") && isBuiltinCommand(trimmed)) {
            dispatchInput?.(trimmed);
            return;
          }
          const lines = trimmed.split("\n").length;
          draftMessage = trimmed;
          output.write(
            `\n${c.dim}(pasted ${lines} line${lines === 1 ? "" : "s"} — Enter to send · Esc to clear)${c.reset}\n`,
          );
          rl.write("");
          prompt();
        },
        onInterrupt: () => {
          handleInterrupt();
        },
      })
    : input;

  const rl = readline.createInterface({
    input: readlineInput,
    output,
    terminal: true,
    completer: completeLine,
  });
  let closed = false;
  let currentChatId: string | undefined;
  let streaming = false;
  let activeTurn: TurnActivity | undefined;
  let draftMessage: string | null = null;
  let continuation = "";

  let hintVisible = false;
  let opsOpen = false;

  // While the agent is working, pause readline so keystrokes are not echoed and
  // stray Enters do not redraw the prompt mid-reply. Ctrl+C still routes via SIGINT.
  let inputSuspended = false;

  const suspendInput = (): void => {
    if (!interactive || inputSuspended) {
      return;
    }
    inputSuspended = true;
    rl.pause();
  };

  const resumeInput = (): void => {
    if (!inputSuspended) {
      return;
    }
    inputSuspended = false;
    rl.resume();
  };

  /** Put stdin back how readline expects it after Ink stole the TTY. */
  const restoreReadlineTty = (): void => {
    if (!interactive) {
      return;
    }
    // Cooked mode after Ink = OS echo + readline echo (double) and no Tab completer.
    if (typeof input.setRawMode === "function") {
      input.setRawMode(true);
    }
    if (output.isTTY) {
      output.write("\x1b[?25h");
    }
  };

  /** Drop partial prompt text and any leaked keystrokes after ops / Ink handoff. */
  const resetPromptInput = (): void => {
    rl.line = "";
    rl.cursor = 0;
    if (output.isTTY) {
      output.write("\r\x1b[2K");
    }
  };

  const openOps = async (): Promise<void> => {
    if (!opsEnabled()) {
      output.write(`${c.dim}ops disabled (AARIA_OPS=0)${c.reset}\n\n`);
      prompt();
      return;
    }
    if (!interactive || opsOpen || closed) {
      return;
    }
    if (streaming) {
      output.write(`${c.warn}wait for the current reply (or /cancel) before opening ops${c.reset}\n\n`);
      prompt();
      return;
    }
    opsOpen = true;
    clearHint();
    resetPromptInput();
    suspendInput();
    // Same stdin feeds both Ink and the paste→readline bridge; mute the bridge
    // so ops keys (especially q) never land in the light-mode prompt.
    if (interactive && "setMuted" in readlineInput) {
      (readlineInput as { setMuted: (m: boolean) => void }).setMuted(true);
    }
    try {
      await runOpsMode();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      output.write(`${c.err}ops exited: ${msg}${c.reset}\n`);
    } finally {
      flushStdin(input);
      resetPromptInput();
      if (interactive && "setMuted" in readlineInput) {
        (readlineInput as { setMuted: (m: boolean) => void }).setMuted(false);
      }
      opsOpen = false;
      restoreReadlineTty();
      resumeInput();
      output.write(`\n ${ariaWordmark()} ${c.dim}back to light TUI${c.reset}\n\n`);
      prompt();
    }
  };

  const prompt = (): void => {
    if (!closed) {
      rl.prompt();
    }
  };

  const finishTurn = (): void => {
    activeTurn?.end();
    activeTurn = undefined;
    streaming = false;
    currentChatId = undefined;
    resumeInput();
    output.write("\n\n");
    prompt();
  };

  const quit = (): void => {
    if (closed) {
      return;
    }
    output.write(`\n${c.dim}bye${c.reset}\n`);
    closed = true;
    client.close();
    rl.close();
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

  /**
   * Cancel in-flight chat, or exit. Must work even while readline is paused
   * during a turn — otherwise Ctrl+C becomes a bare process SIGINT and kills
   * the TUI instead of cancelling.
   */
  handleInterrupt = (): void => {
    if (closed || opsOpen) {
      return;
    }
    clearHint();
    if (streaming && currentChatId) {
      output.write(`\n${c.dim}cancelling…${c.reset}\n`);
      client.cancel(currentChatId);
      return;
    }
    quit();
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
        ? `${c.cmd}${matches[0].name}${c.reset} ${c.dim}— ${matches[0].summary}${c.reset}`
        : matches.map((cmd) => `${c.cmd}${cmd.name}${c.reset}`).join("  ");
    output.write(`\x1b7\n\x1b[2K${c.dim}${text}${c.reset}\x1b8`);
    hintVisible = true;
  };

  if (interactive) {
    // readline listens on readlineInput (not raw stdin); hints must attach there too.
    readlineInput.prependListener("keypress", (_str, key) => {
      if (opsOpen) {
        return;
      }
      // Even if readline is paused, keypress can still fire on some TTYs.
      if (streaming) {
        if (key?.ctrl && key.name === "c") {
          handleInterrupt();
        }
        return;
      }
      if (key?.ctrl && key.name === "o") {
        void openOps();
        return;
      }
      if (draftMessage && key?.name === "escape") {
        draftMessage = null;
        continuation = "";
        rl.setPrompt(userPrefix(userName));
        output.write(`\r\x1b[2K${c.dim}(paste cleared)${c.reset}\n`);
        prompt();
        return;
      }
      if (key && (key.name === "return" || key.name === "enter")) {
        clearHint();
        return;
      }
      setImmediate(renderHint);
    });
  }

  rl.setPrompt(userPrefix(userName));

  rl.on("SIGINT", () => {
    handleInterrupt();
  });

  // While input is suspended (streaming / ops handoff), readline may not emit
  // SIGINT — the terminal delivers a real signal instead. Own it so we cancel.
  process.on("SIGINT", () => {
    handleInterrupt();
  });

  rl.on("line", (line) => {
    void (async () => {
      clearHint();

      if (draftMessage !== null) {
        const text = draftMessage.trim();
        draftMessage = null;
        continuation = "";
        rl.setPrompt(userPrefix(userName));
        if (!text) {
          prompt();
          return;
        }
        await processUserInput(text);
        return;
      }

      if (line.endsWith("\\") && !looksLikeCommand(line.trim())) {
        continuation += `${line.slice(0, -1)}\n`;
        rl.setPrompt(`${c.dim}  … › ${c.reset}`);
        prompt();
        return;
      }

      const hadContinuation = continuation.length > 0;
      const text = `${continuation}${line}`.trim();
      continuation = "";
      rl.setPrompt(userPrefix(userName));

      if (!text) {
        prompt();
        return;
      }

      await processUserInput(text, { alreadyDisplayed: !hadContinuation });
    })();
  });

  async function processUserInput(
    text: string,
    options?: { alreadyDisplayed?: boolean },
  ): Promise<void> {
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
          const mem =
            h.memoryStats != null
              ? ` memory=${h.memoryStats.entries}/${h.memoryStats.limit}ch`
              : h.memory
                ? " memory=yes"
                : "";
          const learn = h.learn?.review
            ? ` ${c.teal}learn=on${c.reset}`
            : ` ${c.dim}learn=off${c.reset}`;
          const warm = h.warm
            ? `${c.ok}yes${c.reset}`
            : `${c.warn}no${c.reset}`;
          output.write(
            `${c.ok}${c.bold}ok${c.reset} warm=${warm} persona=${h.persona ? c.ok + "yes" : c.dim + "no"}${c.reset}${mem}${learn} mcp=${h.mcp?.loaded ? c.teal + h.mcp.servers.join(", ") : c.dim + "off"}${c.reset}\n\n`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          output.write(`${c.err}${msg}${c.reset}\n\n`);
        }
        prompt();
        return;
      }

      if (lower === "/ops") {
        await openOps();
        return;
      }

      if (isMemoryCommand(text)) {
        await handleMemoryCommand(text);
        return;
      }

      if (isSkillsCommand(text)) {
        await handleSkillsCommand();
        return;
      }

      if (isBareSkillCommand(text)) {
        await handleSkillHelpCommand();
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

      // readline already echoed normal typed lines; only print for paste-draft sends.
      if (!text.startsWith("/") && !options?.alreadyDisplayed) {
        output.write(`\n${userPrefix(userName)}${text}\n`);
      }
      pushChatHistory("user", text);

      const turn = new TurnActivity();
      activeTurn = turn;
      turn.begin();

      try {
        currentChatId = client.sendChat(text, {
          onChunk: (chunk) => {
            turn.onChunk(chunk);
          },
          onDone: (reply) => {
            if (!turn.hasContent) {
              output.write(`${agentPrefix()}${c.dim}(no reply)${c.reset}`);
            } else if (reply?.trim()) {
              pushChatHistory("assistant", reply);
            }
            finishTurn();
          },
          onCancelled: (partial) => {
            if (partial) {
              output.write(`\n${c.dim}(cancelled)${c.reset}`);
              pushChatHistory("assistant", partial);
            } else {
              output.write(`\n${c.dim}cancelled${c.reset}`);
            }
            finishTurn();
          },
          onError: (message) => {
            output.write(`\n${c.err}${message}${c.reset}`);
            finishTurn();
          },
        });
      } catch (err) {
        turn.end();
        activeTurn = undefined;
        streaming = false;
        currentChatId = undefined;
        resumeInput();
        const msg = err instanceof Error ? err.message : String(err);
        output.write(`${c.err}${msg}${c.reset}\n\n`);
        prompt();
      }
  }

  async function handleMemoryCommand(text: string): Promise<void> {
    const parts = text.trim().split(/\s+/);
    const sub = (parts[1] ?? "pending").toLowerCase();
    const arg = parts[2]?.toLowerCase();

    try {
      if (sub === "pending" || sub === "list") {
        const res = await fetch(`${apiBase()}/memory/pending`, {
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) {
          throw new Error(`/memory/pending returned ${res.status}`);
        }
        const body = (await res.json()) as {
          pending: Array<{ id: string; target: string; content: string }>;
          approvalRequired?: boolean;
        };
        if (body.pending.length === 0) {
          output.write(`${c.dim}no pending learn entries${c.reset}\n\n`);
        } else {
          for (const entry of body.pending) {
            const style = learnTargetStyle(entry.target);
            output.write(
              `${c.dim}${entry.id}${c.reset} ${style.color}[${entry.target}]${c.reset} ${c.text}${entry.content}${c.reset}\n`,
            );
          }
          output.write("\n");
        }
        prompt();
        return;
      }

      if (sub === "approve") {
        const id = arg && arg !== "all" ? arg : "all";
        const res = await fetch(`${apiBase()}/memory/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
          signal: AbortSignal.timeout(5_000),
        });
        const body = (await res.json()) as {
          ok?: boolean;
          applied?: number;
          preview?: string;
          error?: string;
        };
        if (!res.ok || body.error) {
          throw new Error(body.error ?? `approve failed (${res.status})`);
        }
        if (id === "all") {
          output.write(`${c.ok}approved ${body.applied ?? 0} entries${c.reset}\n\n`);
        } else {
          output.write(`${c.ok}approved${c.reset} ${body.preview ?? id}\n\n`);
        }
        prompt();
        return;
      }

      if (sub === "reject") {
        const id = arg && arg !== "all" ? arg : "all";
        const res = await fetch(`${apiBase()}/memory/reject`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
          signal: AbortSignal.timeout(5_000),
        });
        const body = (await res.json()) as { ok?: boolean; rejected?: number; error?: string };
        if (!res.ok || body.error) {
          throw new Error(body.error ?? `reject failed (${res.status})`);
        }
        if (id === "all") {
          output.write(`${c.dim}rejected ${body.rejected ?? 0} entries${c.reset}\n\n`);
        } else {
          output.write(`${c.dim}rejected ${id}${c.reset}\n\n`);
        }
        prompt();
        return;
      }

      if (sub === "curate" || sub === "consolidate") {
        const res = await fetch(`${apiBase()}/memory/curate`, {
          method: "POST",
          signal: AbortSignal.timeout(120_000),
        });
        const body = (await res.json()) as {
          ok?: boolean;
          error?: string;
          memoryBefore?: number;
          memoryAfter?: number;
        };
        if (!res.ok || body.error) {
          throw new Error(body.error ?? `curate failed (${res.status})`);
        }
        output.write(
          `${c.ok}curated${c.reset} memory ${body.memoryBefore ?? "?"}→${body.memoryAfter ?? "?"} chars\n\n`,
        );
        prompt();
        return;
      }

      output.write(
        `${c.dim}usage: /memory pending · /memory approve [id|all] · /memory reject [id|all] · /memory curate${c.reset}\n\n`,
      );
      prompt();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      output.write(`${c.err}${msg}${c.reset}\n\n`);
      prompt();
    }
  }

  async function handleSkillHelpCommand(): Promise<void> {
    output.write(
      `${c.dim}usage:${c.reset} ${c.cmd}/skill <name> [prompt]${c.reset}\n` +
        `${c.dim}       ${c.cmd}/skills${c.reset}${c.dim} — list installed skills${c.reset}\n`,
    );
    try {
      const res = await fetch(`${apiBase()}/skills`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        throw new Error(`/skills returned ${res.status}`);
      }
      const body = (await res.json()) as {
        skills?: { count: number; names: string[]; path: string };
      };
      const skills = body.skills;
      if (!skills || skills.count === 0) {
        output.write(`${c.dim}no skills installed (${skills?.path ?? "skills/"})${c.reset}\n\n`);
      } else {
        output.write(`${c.dim}${skills.path}${c.reset}\n`);
        for (const name of skills.names) {
          output.write(`  ${c.gold}${name}${c.reset}\n`);
        }
        output.write("\n");
      }
      prompt();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      output.write(`${c.err}${msg}${c.reset}\n\n`);
      prompt();
    }
  }

  async function handleSkillsCommand(): Promise<void> {
    try {
      const res = await fetch(`${apiBase()}/skills`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        throw new Error(`/skills returned ${res.status}`);
      }
      const body = (await res.json()) as {
        skills?: { count: number; names: string[]; path: string };
      };
      const skills = body.skills;
      if (!skills || skills.count === 0) {
        output.write(`${c.dim}no skills installed (${skills?.path ?? "skills/"})${c.reset}\n\n`);
      } else {
        output.write(`${c.dim}${skills.path}${c.reset}\n`);
        for (const name of skills.names) {
          output.write(`  ${c.gold}${name}${c.reset}\n`);
        }
        output.write(`\n${c.dim}load with /skill <name> [prompt]${c.reset}\n\n`);
      }
      prompt();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      output.write(`${c.err}${msg}${c.reset}\n\n`);
      prompt();
    }
  }

  dispatchInput = (text) => {
    void processUserInput(text);
  };

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
