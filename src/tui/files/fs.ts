import { lstat, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export type DirEntry = {
  name: string;
  absolutePath: string;
  isDirectory: boolean;
  isSymlink: boolean;
};

/** Expand leading `~` to the user home (cross-platform via os.homedir). */
export function expandUserPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return process.cwd();
  }
  if (trimmed === "~") {
    return homedir();
  }
  // Accept both / and \ after ~ (Windows paste / mixed paths).
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return path.join(homedir(), trimmed.slice(2));
  }
  return trimmed;
}

/**
 * Resolve a user-supplied start path to an absolute directory.
 * Falls back to cwd when missing or not a directory.
 */
export async function resolveStartDir(input?: string): Promise<string> {
  const raw = expandUserPath(input ?? process.cwd());
  const absolute = path.resolve(raw);
  try {
    const st = await stat(absolute);
    if (st.isDirectory()) {
      return absolute;
    }
    return path.dirname(absolute);
  } catch {
    return process.cwd();
  }
}

/** Parent directory, or null when already at a filesystem root (incl. Windows drive root). */
export function parentDir(dir: string): string | null {
  const resolved = path.resolve(dir);
  const parent = path.dirname(resolved);
  if (parent === resolved) {
    return null;
  }
  return parent;
}

function compareEntries(a: DirEntry, b: DirEntry): number {
  if (a.isDirectory !== b.isDirectory) {
    return a.isDirectory ? -1 : 1;
  }
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/**
 * List directory entries for the picker.
 * Uses Node path / fs APIs only — no shell — so Linux / macOS / Windows behave the same.
 */
export async function listEntries(
  dir: string,
  options?: { showHidden?: boolean },
): Promise<DirEntry[]> {
  const showHidden = options?.showHidden ?? false;
  const absoluteDir = path.resolve(dir);
  let names: string[];
  try {
    names = await readdir(absoluteDir);
  } catch {
    return [];
  }

  const entries: DirEntry[] = [];
  for (const name of names) {
    if (!showHidden && name.startsWith(".")) {
      continue;
    }
    const absolutePath = path.join(absoluteDir, name);
    try {
      const link = await lstat(absolutePath);
      const isSymlink = link.isSymbolicLink();
      // Follow symlink for "is this a directory we can open?"
      const st = isSymlink ? await stat(absolutePath).catch(() => link) : link;
      const isDirectory = st.isDirectory();
      entries.push({ name, absolutePath, isDirectory, isSymlink });
    } catch {
      // unreadable / race — skip
    }
  }

  entries.sort(compareEntries);
  return entries;
}

/** Display path with ~ for home prefix when possible (still absolute under the hood). */
export function displayPath(absolute: string): string {
  const home = homedir();
  const resolved = path.resolve(absolute);
  const homeResolved = path.resolve(home);
  if (resolved === homeResolved) {
    return "~";
  }
  const prefix = homeResolved.endsWith(path.sep)
    ? homeResolved
    : homeResolved + path.sep;
  if (resolved.startsWith(prefix)) {
    return `~${path.sep}${resolved.slice(prefix.length)}`;
  }
  return resolved;
}
