import path from "node:path";

import { fleetCmdWait, fetchFleet, type FleetAgent } from "../ops/api.js";
import {
  formatPathCompletions,
  splitPathPrefix,
  type DirEntry,
  type PathCompleteEntry,
} from "./fs.js";

export type RemoteListResult = {
  path: string;
  entries: DirEntry[];
};

function hasFsCap(agent: FleetAgent): boolean {
  const caps = agent.caps ?? [];
  return caps.includes("fs") || caps.includes("exec") || caps.includes("fs.list");
}

/** Approved, online-ish agents that can run fs.list. */
export async function listBrowsableAgents(): Promise<FleetAgent[]> {
  const snap = await fetchFleet();
  if (!snap.enabled || !snap.connected) {
    throw new Error("fleet bridge not connected");
  }
  return snap.agents.filter(
    (a) =>
      a.status === "approved" &&
      hasFsCap(a) &&
      (a.presence === "online" || a.presence === "idle"),
  );
}

export async function listRemoteEntries(
  agentId: string,
  dir: string,
  options?: { showHidden?: boolean },
): Promise<DirEntry[]> {
  const result = await fleetCmdWait(
    agentId,
    "fs.list",
    { path: dir, showHidden: options?.showHidden === true },
    20_000,
  );
  if (!result.ok) {
    throw new Error(result.error ?? "fs.list failed");
  }
  if (result.error && /unknown cap|not allowed/i.test(result.error)) {
    throw new Error("fs.list unsupported — update ASTRA on this minion");
  }
  const data = result.data as { entries?: DirEntry[] } | undefined;
  if (!data?.entries || !Array.isArray(data.entries)) {
    // Older agents without fs.list return unknown action
    if (typeof result.error === "string" && /unknown/i.test(result.error)) {
      throw new Error("fs.list unsupported — update ASTRA on this minion");
    }
    throw new Error("fs.list returned no entries");
  }
  return data.entries;
}

const remoteListCache = new Map<
  string,
  { at: number; entries: PathCompleteEntry[] }
>();
const REMOTE_LIST_TTL_MS = 15_000;

async function cachedRemoteEntries(
  agentId: string,
  dir: string,
  showHidden: boolean,
): Promise<PathCompleteEntry[]> {
  const key = `${agentId}\0${dir}\0${showHidden ? 1 : 0}`;
  const hit = remoteListCache.get(key);
  if (hit && Date.now() - hit.at < REMOTE_LIST_TTL_MS) {
    return hit.entries;
  }
  const listed = await listRemoteEntries(agentId, dir, { showHidden });
  const entries: PathCompleteEntry[] = listed.map((e) => ({
    name: e.name,
    isDirectory: e.isDirectory,
  }));
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  remoteListCache.set(key, { at: Date.now(), entries });
  return entries;
}

/**
 * Tab-complete a remote path via ASTRA `fs.list`.
 * Passes `~` through to the minion (does not expand to the desk home).
 */
export async function completeRemotePath(
  agentId: string,
  partial: string,
  options?: { limit?: number },
): Promise<string[]> {
  const { dir, base, sep, typedDir } = splitPathPrefix(partial);
  const listDir = dir === "." ? "/" : dir;
  try {
    const entries = await cachedRemoteEntries(
      agentId,
      listDir,
      base.startsWith("."),
    );
    return formatPathCompletions(typedDir, base, entries, sep, {
      limit: options?.limit,
      showHidden: base.startsWith("."),
    });
  } catch {
    return [];
  }
}

export async function readRemoteFile(
  agentId: string,
  filePath: string,
): Promise<{ content: string; path: string; mtime?: string }> {
  const result = await fleetCmdWait(
    agentId,
    "fs.read",
    { path: filePath },
    30_000,
  );
  if (!result.ok) {
    throw new Error(result.error ?? "fs.read failed");
  }
  const data = result.data as {
    content?: string;
    path?: string;
    mtime?: string;
  };
  if (typeof data?.content !== "string") {
    throw new Error("fs.read returned no content");
  }
  return {
    content: data.content,
    path: data.path ?? filePath,
    mtime: data.mtime,
  };
}

export async function writeRemoteFile(
  agentId: string,
  filePath: string,
  content: string,
): Promise<void> {
  const result = await fleetCmdWait(
    agentId,
    "fs.write",
    { path: filePath, content },
    30_000,
  );
  if (!result.ok) {
    throw new Error(result.error ?? "fs.write failed");
  }
}

/** Format paths for the chat draft so AARIA knows the minion. */
export function formatRemoteDraftPaths(agentId: string, paths: string[]): string {
  return paths.map((p) => `[${agentId}] ${p}`).join("\n");
}

export function remoteParentDir(dir: string): string | null {
  const resolved = path.posix.resolve(dir);
  // Prefer posix for remote Linux minions; also handle Windows-style if present.
  const normalized = dir.includes("\\") ? path.win32.resolve(dir) : resolved;
  const parent = dir.includes("\\")
    ? path.win32.dirname(normalized)
    : path.posix.dirname(normalized);
  if (parent === normalized) {
    return null;
  }
  return parent;
}

export function displayRemotePath(p: string): string {
  return p;
}
