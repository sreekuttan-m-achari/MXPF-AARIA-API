import { stdin as input, stdout as output } from "node:process";

import React from "react";
import { render } from "ink";

import { flushStdin } from "../paste-input.js";
import { OpsApp } from "./App.js";

/**
 * Mount the Ink ops overlay until the user exits (q / Esc / Ctrl+O).
 * Caller must pause readline + mute the paste bridge before, and restore
 * raw-mode TTY for readline after.
 */
export async function runOpsMode(): Promise<void> {
  if (output.isTTY) {
    // Clear screen + home cursor for a clean panel canvas.
    output.write("\x1b[2J\x1b[H");
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
    // Drain leftovers while still raw — do NOT leave the TTY in cooked mode
    // (that causes double-echo + dead Tab/autocomplete when readline resumes).
    flushStdin(input);
    if (input.isTTY && typeof input.setRawMode === "function") {
      input.setRawMode(true);
    }
    if (output.isTTY) {
      output.write("\x1b[?25h\x1b[2J\x1b[H");
    }
  }
}
