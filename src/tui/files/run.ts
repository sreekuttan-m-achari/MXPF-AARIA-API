import { stdin as input, stdout as output } from "node:process";

import React from "react";
import { render } from "ink";

import { flushStdin } from "../paste-input.js";
import { FileBrowserApp } from "./App.js";
import { resolveStartDir } from "./fs.js";

const ENTER_ALT = "\x1b[?1049h";
const LEAVE_ALT = "\x1b[?1049l";
const CLEAR = "\x1b[2J\x1b[H";
const SHOW_CURSOR = "\x1b[?25h";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Mount the Ink file browser until confirm or cancel.
 * Uses the alternate screen so the light-mode chat transcript is preserved.
 * Caller must pause readline + mute the paste bridge before, and restore
 * raw-mode TTY for readline after.
 *
 * @returns Absolute paths (platform-native separators), or null if cancelled.
 */
export async function runFileBrowser(startPath?: string): Promise<string[] | null> {
  const startDir = await resolveStartDir(startPath);

  if (output.isTTY) {
    output.write(`${ENTER_ALT}${CLEAR}`);
  }

  let result: string[] | null = null;

  const instance = render(
    React.createElement(FileBrowserApp, {
      startDir,
      onDone: (paths) => {
        result = paths;
      },
    }),
    {
      stdin: input,
      stdout: output,
      exitOnCtrlC: false,
    },
  );

  try {
    await instance.waitUntilExit();
  } finally {
    instance.unmount();
    await sleep(40);
    flushStdin(input);
    await sleep(20);
    flushStdin(input);
    if (input.isTTY && typeof input.setRawMode === "function") {
      input.setRawMode(true);
    }
    if (output.isTTY) {
      output.write(`${LEAVE_ALT}${SHOW_CURSOR}`);
    }
  }

  return result;
}
