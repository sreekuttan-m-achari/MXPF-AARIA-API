import type { AgentRuntimeKind } from "./types.js";

/** Resolve harness from `AARIA_RUNTIME` (default: cursor). */
export function resolveRuntimeKind(): AgentRuntimeKind {
  const raw = process.env.AARIA_RUNTIME?.trim().toLowerCase() ?? "";
  if (raw === "claude" || raw === "anthropic") {
    return "claude";
  }
  return "cursor";
}

/**
 * Claude model id. Cursor-only values (`default`, `composer-*`) fall through to
 * `AARIA_CLAUDE_MODEL` or Sonnet.
 */
export function resolveClaudeModelId(
  envName = "AARIA_MODEL",
  fallback = "claude-sonnet-4-5",
): string {
  const override = process.env.AARIA_CLAUDE_MODEL?.trim();
  const raw = process.env[envName]?.trim();
  if (!raw || raw === "default" || raw.startsWith("composer")) {
    return override && override.length > 0 ? override : fallback;
  }
  return raw;
}
