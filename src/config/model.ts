import type { ModelSelection } from "@cursor/sdk";

/** Default Cursor model when unset — composer-2.5 standard is Cursor's cheapest agent model. */
export const DEFAULT_AARIA_MODEL = "composer-2.5";

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
