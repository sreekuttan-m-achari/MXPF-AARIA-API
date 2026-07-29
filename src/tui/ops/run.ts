import { stdin as input, stdout as output } from "node:process";

import React from "react";
import { render } from "ink";

import { flushStdin } from "../paste-input.js";
import { OpsApp } from "./App.js";

const ENTER_ALT = "\x1b[?1049h";
const LEAVE_ALT = "\x1b[?1049l";
const CLEAR = "\x1b[2J\x1b[H";
const SHOW_CURSOR = "\x1b[?25h";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Mount the Ink ops overlay until the user exits (q / Esc / Ctrl+O).
 * Uses the alternate screen so the light-mode chat transcript is preserved.
 * Caller must pause readline + mute the paste bridge before, and restore
 * raw-mode TTY for readline after.
 */
export async function runOpsMode(): Promise<void> {
  if (output.isTTY) {
    // Alternate screen keeps the light TUI scrollback intact under ops.
    output.write(`${ENTER_ALT}${CLEAR}`);
  }

  const instance = render(React.createElement(OpsApp), {
    stdin: input,
    stdout: output,
    exitOnCtrlC: false,
  });

  try {
    await instance.waitUntilExit();
  } finally {
    instance.unmount();
    // Esc / CSI remnants often arrive a tick after Ink exits — mute is still on;
    // drain after a short settle so they never reach readline.
    await sleep(40);
    flushStdin(input);
    await sleep(20);
    flushStdin(input);
    if (input.isTTY && typeof input.setRawMode === "function") {
      input.setRawMode(true);
    }
    if (output.isTTY) {
      // Leave alt screen = restore prior light-mode buffer; then show cursor.
      output.write(`${LEAVE_ALT}${SHOW_CURSOR}`);
    }
  }
}
