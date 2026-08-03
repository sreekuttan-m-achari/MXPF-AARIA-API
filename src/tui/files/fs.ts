import { lstatSync, readdirSync, statSync } from "node:fs";
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

/** Split a typed path prefix into directory + basename for Tab completion. */
export function splitPathPrefix(partial: string): {
  dir: string;
  base: string;
  sep: string;
  /** User-facing directory prefix including trailing sep (empty when relative basename only). */
  typedDir: string;
} {
  const sep = partial.includes("\\") && !partial.includes("/") ? "\\" : "/";
  if (partial.endsWith("/") || partial.endsWith("\\")) {
    const dir = partial.slice(0, -1);
    return {
      dir: dir === "" ? sep : dir,
      base: "",
      sep,
      typedDir: partial,
    };
  }
  const idx = Math.max(partial.lastIndexOf("/"), partial.lastIndexOf("\\"));
  if (idx === -1) {
    return { dir: ".", base: partial, sep, typedDir: "" };
  }
  const dir = partial.slice(0, idx);
  return {
    dir: dir === "" ? sep : dir,
    base: partial.slice(idx + 1),
    sep,
    typedDir: partial.slice(0, idx + 1),
  };
}

export type PathCompleteEntry = {
  name: string;
  isDirectory: boolean;
};

/**
 * Build readline completion strings from directory entries, preserving the
 * user-typed directory prefix (including leading `~`).
 */
export function formatPathCompletions(
  typedDir: string,
  base: string,
  entries: PathCompleteEntry[],
  sep = "/",
  options?: { limit?: number; showHidden?: boolean },
): string[] {
  const limit = options?.limit ?? 80;
  const showHidden = options?.showHidden ?? base.startsWith(".");
  const lowerBase = base.toLowerCase();
  const hits: string[] = [];
  for (const entry of entries) {
    if (!showHidden && entry.name.startsWith(".")) {
      continue;
    }
    if (base && !entry.name.toLowerCase().startsWith(lowerBase)) {
      continue;
    }
    hits.push(
      `${typedDir}${entry.name}${entry.isDirectory ? sep : ""}`,
    );
    if (hits.length >= limit) {
      break;
    }
  }
  return hits;
}

/**
 * Sync local filesystem path completions for `/files <path>` Tab.
 * Preserves a leading `~` in the returned strings when the user typed one.
 */
export function completeLocalPath(
  partial: string,
  options?: { limit?: number },
): string[] {
  const trimmed = partial;
  if (trimmed === "~") {
    return ["~/"];
  }

  const { dir, base, sep, typedDir } = splitPathPrefix(trimmed);
  let absDir: string;
  try {
    absDir = path.resolve(expandUserPath(dir === "." ? process.cwd() : dir));
  } catch {
    return [];
  }

  let names: string[];
  try {
    names = readdirSync(absDir);
  } catch {
    return [];
  }

  names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  const entries: PathCompleteEntry[] = [];
  for (const name of names) {
    const absolutePath = path.join(absDir, name);
    let isDirectory = false;
    try {
      const link = lstatSync(absolutePath);
      if (link.isSymbolicLink()) {
        try {
          isDirectory = statSync(absolutePath).isDirectory();
        } catch {
          isDirectory = false;
        }
      } else {
        isDirectory = link.isDirectory();
      }
    } catch {
      continue;
    }
    entries.push({ name, isDirectory });
  }

  // Dirs first, then files (stable within each group via prior name sort).
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return 0;
  });

  return formatPathCompletions(typedDir, base, entries, sep, {
    limit: options?.limit,
    showHidden: base.startsWith("."),
  });
}
