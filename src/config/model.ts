import type { ModelSelection } from "@cursor/sdk";

/** Default Cursor model when unset — `default` = Auto (routes to included pool, e.g. Grok). */
export const DEFAULT_AARIA_MODEL = "default";

export function resolveModelId(envName: string, fallback: string = DEFAULT_AARIA_MODEL): string {
  const raw = process.env[envName]?.trim();
  return raw && raw.length > 0 ? raw : fallback;
}

export function resolveModelSelection(
  envName: string,
  fallback: string = DEFAULT_AARIA_MODEL,
): ModelSelection {
  return { id: resolveModelId(envName, fallback) };
}
