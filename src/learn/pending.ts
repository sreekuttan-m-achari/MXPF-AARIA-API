import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { agentCwd } from "../persona.js";
import {
  applyLearnEntry,
  type LearnWriteResult,
  type MemoryTarget,
} from "./memory-store.js";

export type PendingLearnEntry = {
  id: string;
  target: MemoryTarget;
  content: string;
  createdAt: string;
  source: "auto";
};

function pendingPath(cwd: string = agentCwd()): string {
  return resolve(cwd, ".aria-learn-pending.json");
}

export function isLearnApprovalRequired(): boolean {
  const v = process.env.AARIA_LEARN_APPROVAL?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function loadPending(cwd: string = agentCwd()): PendingLearnEntry[] {
  const path = pendingPath(cwd);
  if (!existsSync(path)) {
    return [];
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (e): e is PendingLearnEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as PendingLearnEntry).id === "string" &&
        typeof (e as PendingLearnEntry).content === "string",
    );
  } catch {
    return [];
  }
}

function savePending(entries: PendingLearnEntry[], cwd: string = agentCwd()): void {
  const path = pendingPath(cwd);
  if (entries.length === 0) {
    if (existsSync(path)) {
      unlinkSync(path);
    }
    return;
  }
  mkdirSync(agentCwd(), { recursive: true });
  writeFileSync(path, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}

export function stageLearnEntry(
  target: MemoryTarget,
  content: string,
  cwd: string = agentCwd(),
): PendingLearnEntry {
  const entry: PendingLearnEntry = {
    id: randomUUID().slice(0, 8),
    target,
    content: content.trim(),
    createdAt: new Date().toISOString(),
    source: "auto",
  };
  const pending = loadPending(cwd);
  pending.push(entry);
  savePending(pending, cwd);
  return entry;
}

export function approvePending(
  id: string,
  cwd: string = agentCwd(),
): LearnWriteResult & { id?: string; target?: MemoryTarget } {
  const pending = loadPending(cwd);
  const idx = pending.findIndex((e) => e.id === id);
  if (idx === -1) {
    return { ok: false, error: `no pending entry ${id}` };
  }
  const [entry] = pending.splice(idx, 1);
  savePending(pending, cwd);
  const result = applyLearnEntry(entry.target, entry.content, cwd);
  return result.ok
    ? { ...result, id: entry.id, target: entry.target }
    : result;
}

export function approveAllPending(cwd: string = agentCwd()): {
  applied: number;
  errors: string[];
} {
  const pending = loadPending(cwd);
  let applied = 0;
  const errors: string[] = [];
  for (const entry of pending) {
    const result = applyLearnEntry(entry.target, entry.content, cwd);
    if (result.ok) {
      applied += 1;
    } else {
      errors.push(`${entry.id}: ${result.error}`);
    }
  }
  savePending([], cwd);
  return { applied, errors };
}

export function rejectPending(id: string, cwd: string = agentCwd()): boolean {
  const pending = loadPending(cwd);
  const next = pending.filter((e) => e.id !== id);
  if (next.length === pending.length) {
    return false;
  }
  savePending(next, cwd);
  return true;
}

export function rejectAllPending(cwd: string = agentCwd()): number {
  const count = loadPending(cwd).length;
  savePending([], cwd);
  return count;
}
