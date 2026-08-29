import type { ModelSelection } from "@cursor/sdk";

import { loadAariaConfig } from "./load.js";

/** Default Cursor model when unset — `default` = Auto (routes to included pool, e.g. Grok). */
export const DEFAULT_AARIA_MODEL = "default";

export function resolveModelId(envName: string, fallback: string = DEFAULT_AARIA_MODEL): string {
  const raw = process.env[envName]?.trim();
  if (raw && raw.length > 0) return raw;

  const brain = loadAariaConfig().brain;
  const configured =
    envName === "AARIA_LEARN_MODEL" ? brain.learnModel : brain.model;
  return configured ?? fallback;
}

export function resolveModelSelection(
  envName: string,
  fallback: string = DEFAULT_AARIA_MODEL,
): ModelSelection {
  return { id: resolveModelId(envName, fallback) };
}
