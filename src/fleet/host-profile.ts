import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { agentCwd } from "../persona.js";

export type HostProfile = {
  purpose: string;
  os?: string;
  arch?: string;
  summary: string;
  updatedAt: string;
  hash: string;
};

export function parseHostPayload(raw: unknown): HostProfile | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const purpose = typeof o.purpose === "string" ? o.purpose.trim() : "";
  const summary = typeof o.summary === "string" ? o.summary.trim() : "";
  if (!purpose || !summary) return undefined;
  const updatedAt =
    typeof o.updatedAt === "string" && o.updatedAt
      ? o.updatedAt
      : new Date().toISOString();
  const hash = typeof o.hash === "string" ? o.hash : "";
  return {
    purpose,
    os: typeof o.os === "string" ? o.os : undefined,
    arch: typeof o.arch === "string" ? o.arch : undefined,
    summary,
    updatedAt,
    hash,
  };
}

export function hostMirrorPath(
  agentId: string,
  cwd: string = agentCwd(),
): string {
  return path.join(cwd, "data", "fleet", "hosts", `${agentId}.md`);
}

export async function writeHostMirror(
  agentId: string,
  host: HostProfile,
  fullMarkdown?: string,
  cwd?: string,
): Promise<void> {
  const file = hostMirrorPath(agentId, cwd);
  await mkdir(path.dirname(file), { recursive: true });
  const body =
    fullMarkdown?.trim() ||
    [
      `# Host profile — ${agentId}`,
      `Updated: ${host.updatedAt}`,
      "",
      "## Purpose",
      host.purpose,
      "",
      host.os ? `## OS\n${host.os}\n` : "",
      host.arch ? `## Arch\n${host.arch}\n` : "",
      "## Summary (from announce)",
      "",
      host.summary,
      "",
      host.hash ? `Hash: ${host.hash}` : "",
      "",
    ]
      .filter(Boolean)
      .join("\n");
  await writeFile(file, body.endsWith("\n") ? body : `${body}\n`, "utf8");
}
