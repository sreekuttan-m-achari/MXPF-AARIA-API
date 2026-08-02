import { accessSync, constants, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { platform } from "node:os";
import { stdin as input, stdout as output } from "node:process";

/** Soft cap for opening files in an external editor (bytes). */
export const MAX_EDIT_BYTES = 2 * 1024 * 1024;

const FALLBACKS_UNIX = ["nano", "vim", "vi", "notepad"] as const;
const FALLBACKS_WIN = ["notepad", "nano", "vim", "vi"] as const;

function whichExists(bin: string): boolean {
  // Absolute / relative path with separator — check directly.
  if (bin.includes("/") || bin.includes("\\")) {
    try {
      accessSync(bin, constants.X_OK);
      return true;
    } catch {
      try {
        accessSync(bin, constants.F_OK);
        return true;
      } catch {
        return false;
      }
    }
  }
  const pathEnv = process.env.PATH ?? "";
  const sep = platform() === "win32" ? ";" : ":";
  const exts =
    platform() === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean)
      : [""];
  for (const dir of pathEnv.split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = `${dir}${platform() === "win32" ? "\\" : "/"}${bin}${ext}`;
      try {
        accessSync(candidate, constants.F_OK);
        return true;
      } catch {
        // continue
      }
    }
  }
  return false;
}

/**
 * Resolve editor binary: AARIA_EDITOR → EDITOR → nano/vim/vi (Unix) or notepad (Windows).
 */
export function resolveEditor(): string {
  const preferred = [
    process.env.AARIA_EDITOR?.trim(),
    process.env.EDITOR?.trim(),
    process.env.VISUAL?.trim(),
  ].filter((v): v is string => Boolean(v && v.length > 0));

  const fallbacks =
    platform() === "win32" ? FALLBACKS_WIN : FALLBACKS_UNIX;

  for (const cand of [...preferred, ...fallbacks]) {
    // EDITOR may be "nano -w" — take first token for existence check; spawn with shell if spaces.
    const bin = cand.split(/\s+/)[0]!;
    if (whichExists(bin) || whichExists(cand)) {
      return cand;
    }
  }
  throw new Error(
    "no editor found — set AARIA_EDITOR or EDITOR (e.g. nano, vim)",
  );
}

export function assertEditableFile(filePath: string): void {
  let st;
  try {
    st = statSync(filePath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`cannot open: ${msg}`);
  }
  if (!st.isFile()) {
    throw new Error("not a regular file");
  }
  if (st.size > MAX_EDIT_BYTES) {
    throw new Error(
      `file too large for editor (${st.size} bytes; max ${MAX_EDIT_BYTES})`,
    );
  }
}

function splitEditorCommand(editor: string): { cmd: string; args: string[] } {
  const tokens = editor.trim().split(/\s+/).filter(Boolean);
  return { cmd: tokens[0]!, args: tokens.slice(1) };
}

/**
 * Open a local file in the resolved terminal editor (stdio inherited).
 * Caller must release the TTY from Ink / readline first (cooked mode).
 */
export async function openInEditor(filePath: string): Promise<void> {
  assertEditableFile(filePath);
  const editor = resolveEditor();
  const { cmd, args } = splitEditorCommand(editor);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, [...args, filePath], {
      stdio: "inherit",
      shell: false,
      env: process.env,
    });

    child.on("error", reject);
    child.on("exit", (_code, signal) => {
      if (signal) {
        reject(new Error(`editor killed (${signal})`));
        return;
      }
      resolve();
    });
  });
}

/**
 * Run `fn` with stdin in cooked mode so an external editor can own the TTY.
 * Assumes the Ink alt-screen is already left (browser unmounted).
 */
export async function withCookedStdin<T>(fn: () => Promise<T>): Promise<T> {
  const SHOW_CURSOR = "\x1b[?25h";
  if (output.isTTY) {
    output.write(SHOW_CURSOR);
  }
  if (input.isTTY && typeof input.setRawMode === "function") {
    input.setRawMode(false);
  }
  try {
    return await fn();
  } finally {
    if (input.isTTY && typeof input.setRawMode === "function") {
      input.setRawMode(true);
    }
  }
}
