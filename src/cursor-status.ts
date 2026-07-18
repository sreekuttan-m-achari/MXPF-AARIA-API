import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Cursor } from "@cursor/sdk";

import { buildContextStatus } from "./context-status.js";
import { resolveModelId } from "./config/model.js";
import { agentCwd } from "./persona.js";
import { getUsageSnapshot } from "./usage.js";
import { isWarm } from "./warmup.js";

type AccountInfo = {
  apiKeyName: string;
  userId?: number;
  userEmail?: string;
  userFirstName?: string;
  userLastName?: string;
  createdAt: string;
};

type ModelsCache = {
  at: string;
  count: number;
  ids: string[];
};

let accountCache:
  | { at: number; ok: true; account: AccountInfo }
  | { at: number; ok: false; error: string }
  | undefined;

let modelsCache: { at: number; data: ModelsCache } | undefined;

const ACCOUNT_TTL_MS = 5 * 60_000;
const MODELS_TTL_MS = 15 * 60_000;

function maskApiKey(key: string | undefined): {
  configured: boolean;
  hint: string;
} {
  if (!key || key.length < 8) {
    return { configured: Boolean(key), hint: key ? "(short)" : "(unset)" };
  }
  return {
    configured: true,
    hint: `${key.slice(0, 6)}…${key.slice(-4)}`,
  };
}

function sdkPackageVersion(): string | undefined {
  try {
    const pkgPath = join(
      process.cwd(),
      "node_modules",
      "@cursor",
      "sdk",
      "package.json",
    );
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    return pkg.version;
  } catch {
    return undefined;
  }
}

async function getAccount(): Promise<
  { ok: true; account: AccountInfo } | { ok: false; error: string }
> {
  const now = Date.now();
  if (accountCache && now - accountCache.at < ACCOUNT_TTL_MS) {
    return accountCache.ok
      ? { ok: true, account: accountCache.account }
      : { ok: false, error: accountCache.error };
  }

  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    accountCache = { at: now, ok: false, error: "CURSOR_API_KEY unset" };
    return { ok: false, error: accountCache.error };
  }

  try {
    const me = await Cursor.me({ apiKey });
    const account: AccountInfo = {
      apiKeyName: me.apiKeyName,
      userId: me.userId,
      userEmail: me.userEmail,
      userFirstName: me.userFirstName,
      userLastName: me.userLastName,
      createdAt: me.createdAt,
    };
    accountCache = { at: now, ok: true, account };
    return { ok: true, account };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    accountCache = { at: now, ok: false, error };
    return { ok: false, error };
  }
}

async function getModels(): Promise<ModelsCache | null> {
  const now = Date.now();
  if (modelsCache && now - modelsCache.at < MODELS_TTL_MS) {
    return modelsCache.data;
  }
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }
  try {
    const models = await Cursor.models.list({ apiKey });
    const data: ModelsCache = {
      at: new Date().toISOString(),
      count: models.length,
      ids: models.map((m) => m.id).slice(0, 40),
    };
    modelsCache = { at: now, data };
    return data;
  } catch {
    return modelsCache?.data ?? null;
  }
}

export async function buildCursorStatus(sessionId?: string): Promise<{
  ok: true;
  config: {
    model: string;
    learnModel: string;
    apiKeyConfigured: boolean;
    apiKeyHint: string;
    agentCwd: string;
    sessionId?: string;
    warm: boolean;
    sdkVersion?: string;
  };
  account: AccountInfo | null;
  accountError?: string;
  models: ModelsCache | null;
  usage: ReturnType<typeof getUsageSnapshot>;
  context: ReturnType<typeof buildContextStatus>;
}> {
  const key = process.env.CURSOR_API_KEY?.trim();
  const masked = maskApiKey(key);
  const accountResult = await getAccount();
  const models = await getModels();

  return {
    ok: true,
    config: {
      model: resolveModelId("AARIA_MODEL"),
      learnModel: resolveModelId("AARIA_LEARN_MODEL"),
      apiKeyConfigured: masked.configured,
      apiKeyHint: masked.hint,
      agentCwd: agentCwd(),
      sessionId,
      warm: isWarm(),
      sdkVersion: sdkPackageVersion(),
    },
    account: accountResult.ok ? accountResult.account : null,
    accountError: accountResult.ok ? undefined : accountResult.error,
    models,
    usage: getUsageSnapshot(),
    context: buildContextStatus(),
  };
}
