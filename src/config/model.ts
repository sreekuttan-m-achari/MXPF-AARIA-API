import type { ModelSelection } from "@cursor/sdk";

/** Main-branch default Cursor model when unset. */
export const DEFAULT_AARIA_MODEL = "composer-2";

export function resolveModelId(
  envName: string,
  fallback: string = DEFAULT_AARIA_MODEL,
): string {
  const raw = process.env[envName]?.trim();
  return raw && raw.length > 0 ? raw : fallback;
}

export function resolveModelSelection(
  envName: string,
  fallback: string = DEFAULT_AARIA_MODEL,
): ModelSelection {
  return { id: resolveModelId(envName, fallback) };
}
