import type { ModelProvider } from "mxpf-ai-harness";

const LOCAL_OPENAI_PORTS = new Set(["11434", "1234", "8000"]);

function looksLikeLocalOpenAiPipe(baseURL: string): boolean {
  const lower = baseURL.toLowerCase();
  if (
    lower.includes("openrouter") ||
    lower.includes("ollama") ||
    lower.includes("lmstudio") ||
    lower.includes("lm.studio") ||
    lower.includes("vllm") ||
    lower.includes("colibri")
  ) {
    return true;
  }
  try {
    const u = new URL(baseURL);
    const host = u.hostname.toLowerCase();
    const localHost =
      host === "localhost" || host === "127.0.0.1" || host === "::1";
    // Require an explicit port in LOCAL_OPENAI_PORTS ("" means default 80/443).
    return localHost && LOCAL_OPENAI_PORTS.has(u.port);
  } catch {
    return false;
  }
}

/** Resolve openai vs anthropic client for MXPF harness model pipe. */
export function resolveMxpfProvider(baseURL?: string): ModelProvider {
  const raw =
    process.env.MXPF_HARNESS_PROVIDER?.trim().toLowerCase() ||
    process.env.AARIA_MXPF_PROVIDER?.trim().toLowerCase() ||
    "";
  if (raw === "anthropic" || raw === "openai") return raw;
  if (baseURL && looksLikeLocalOpenAiPipe(baseURL)) return "openai";
  if (baseURL?.toLowerCase().includes("anthropic")) return "anthropic";
  return "openai";
}
