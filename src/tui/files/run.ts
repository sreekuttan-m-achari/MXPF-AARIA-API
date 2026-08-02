import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import React from "react";
import { render } from "ink";

import { flushStdin } from "../paste-input.js";
import { AgentPickerApp } from "./AgentPicker.js";
import { FileBrowserApp, type BrowserOutcome, type BrowserSession } from "./App.js";
import { openInEditor, withCookedStdin } from "./editor.js";
import {
  displayPath,
  listEntries,
  parentDir,
  resolveStartDir,
  type DirEntry,
} from "./fs.js";
import {
  displayRemotePath,
  listBrowsableAgents,
  listRemoteEntries,
  readRemoteFile,
  remoteParentDir,
  writeRemoteFile,
} from "./remote.js";

const ENTER_ALT = "\x1b[?1049h";
const LEAVE_ALT = "\x1b[?1049l";
const CLEAR = "\x1b[2J\x1b[H";
const SHOW_CURSOR = "\x1b[?25h";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type RunFileBrowserOptions = {
  mode?: "local" | "remote";
  agentId?: string;
  startPath?: string;
};

async function withAltScreen<T>(run: () => Promise<T>): Promise<T> {
  if (output.isTTY) {
    output.write(`${ENTER_ALT}${CLEAR}`);
  }
  try {
    return await run();
  } finally {
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
}

async function mountBrowser(
  session: BrowserSession,
  options: {
    subtitle?: string;
    listEntriesFn?: typeof listEntries;
    displayPathFn?: (p: string) => string;
    parentDirFn?: typeof parentDir;
  } = {},
): Promise<BrowserOutcome> {
  return withAltScreen(async () => {
    let outcome: BrowserOutcome = { action: "cancel" };
    const instance = render(
      React.createElement(FileBrowserApp, {
        session,
        subtitle: options.subtitle,
        listEntriesFn: options.listEntriesFn,
        displayPathFn: options.displayPathFn,
        parentDirFn: options.parentDirFn,
        onDone: (next) => {
          outcome = next;
        },
      }),
      { stdin: input, stdout: output, exitOnCtrlC: false },
    );
    try {
      await instance.waitUntilExit();
    } finally {
      instance.unmount();
    }
    return outcome;
  });
}

async function pickRemoteAgent(preferred?: string): Promise<string | null> {
  if (preferred) {
    return preferred;
  }
  const agents = await listBrowsableAgents();
  if (agents.length === 0) {
    throw new Error("no approved online minions with exec/fs");
  }
  if (agents.length === 1) {
    return agents[0]!.agentId;
  }

  return withAltScreen(async () => {
    let selected: string | null = null;
    const instance = render(
      React.createElement(AgentPickerApp, {
        agents,
        onDone: (id) => {
          selected = id;
        },
      }),
      { stdin: input, stdout: output, exitOnCtrlC: false },
    );
    try {
      await instance.waitUntilExit();
    } finally {
      instance.unmount();
    }
    return selected;
  });
}

async function confirmWriteBack(prompt: string): Promise<boolean> {
  return withCookedStdin(async () => {
    const rl = createInterface({ input, output, terminal: true });
    try {
      const answer = (await rl.question(`${prompt} [y/N] `)).trim().toLowerCase();
      return answer === "y" || answer === "yes";
    } finally {
      rl.close();
    }
  });
}

async function editLocalFile(filePath: string): Promise<void> {
  await withCookedStdin(async () => {
    output.write(`\nopening editor…\n`);
    await openInEditor(filePath);
  });
}

async function editRemoteFile(agentId: string, remotePath: string): Promise<void> {
  const remote = await readRemoteFile(agentId, remotePath);
  const hash = createHash("sha1")
    .update(`${agentId}:${remotePath}`)
    .digest("hex")
    .slice(0, 12);
  const dir = path.join(tmpdir(), "aaria-edit");
  await mkdir(dir, { recursive: true });
  const base = path.basename(remotePath) || "file.txt";
  const localPath = path.join(dir, `${hash}-${base}`);
  await writeFile(localPath, remote.content, "utf8");

  await withCookedStdin(async () => {
    output.write(`\nopening editor for [${agentId}] ${remotePath}\n`);
    await openInEditor(localPath);
  });

  const after = await readFile(localPath, "utf8");
  if (after === remote.content) {
    return;
  }

  const ok = await confirmWriteBack(
    `Write changes back to [${agentId}] ${remotePath}?`,
  );
  if (!ok) {
    output.write(`discarded remote edits (local copy: ${localPath})\n`);
    return;
  }
  await writeRemoteFile(agentId, remotePath, after);
  output.write(`wrote [${agentId}] ${remotePath}\n`);
}

async function runBrowseLoop(options: {
  session: BrowserSession;
  subtitle?: string;
  listEntriesFn: (
    dir: string,
    opts?: { showHidden?: boolean },
  ) => Promise<DirEntry[]>;
  displayPathFn: (p: string) => string;
  parentDirFn: (dir: string) => string | null;
  onEdit: (filePath: string) => Promise<void>;
}): Promise<string[] | null> {
  let session = options.session;

  for (;;) {
    const outcome = await mountBrowser(session, {
      subtitle: options.subtitle,
      listEntriesFn: options.listEntriesFn,
      displayPathFn: options.displayPathFn,
      parentDirFn: options.parentDirFn,
    });
    if (outcome.action === "cancel") {
      return null;
    }
    if (outcome.action === "confirm") {
      return outcome.paths;
    }

    session = outcome.session;
    try {
      await options.onEdit(outcome.path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      output.write(`\n${msg}\n(press Enter to continue)`);
      await withCookedStdin(
        () =>
          new Promise<void>((resolve) => {
            const onData = (chunk: Buffer | string) => {
              const s = typeof chunk === "string" ? chunk : chunk.toString("utf8");
              if (s.includes("\n") || s.includes("\r")) {
                input.off("data", onData);
                resolve();
              }
            };
            input.on("data", onData);
          }),
      );
    }
  }
}

/**
 * Mount the Ink file browser until confirm or cancel.
 * Supports local and remote (ASTRA) modes, plus external editor (`e`).
 */
export async function runFileBrowser(
  startPathOrOpts?: string | RunFileBrowserOptions,
): Promise<string[] | null> {
  const opts: RunFileBrowserOptions =
    typeof startPathOrOpts === "string" || startPathOrOpts === undefined
      ? { mode: "local", startPath: startPathOrOpts }
      : startPathOrOpts;

  const mode = opts.mode ?? "local";

  if (mode === "remote") {
    let agentId: string | null;
    try {
      agentId = await pickRemoteAgent(opts.agentId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      output.write(`\nremote files: ${msg}\n`);
      return null;
    }
    if (!agentId) {
      return null;
    }

    const startDir = opts.startPath?.trim() || "/";
    return runBrowseLoop({
      session: {
        cwd: startDir,
        selected: [],
        showHidden: false,
      },
      subtitle: `remote · ${agentId}`,
      listEntriesFn: (dir, listOpts) => listRemoteEntries(agentId!, dir, listOpts),
      displayPathFn: displayRemotePath,
      parentDirFn: remoteParentDir,
      onEdit: (filePath) => editRemoteFile(agentId!, filePath),
    }).then((paths) =>
      paths ? paths.map((p) => `[${agentId}] ${p}`) : null,
    );
  }

  const startDir = await resolveStartDir(opts.startPath);
  return runBrowseLoop({
    session: {
      cwd: startDir,
      selected: [],
      showHidden: false,
    },
    listEntriesFn: listEntries,
    displayPathFn: displayPath,
    parentDirFn: parentDir,
    onEdit: editLocalFile,
  });
}
