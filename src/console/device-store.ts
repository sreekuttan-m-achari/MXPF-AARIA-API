import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";

const DeviceSchema = z.object({
  deviceId: z.string().min(1),
  deviceToken: z.string().min(1),
  label: z.string().default(""),
  operatorName: z.string().optional(),
  pairedAt: z.string().min(1),
  expiresAt: z.string().min(1),
});

export type ConsoleDevice = z.infer<typeof DeviceSchema>;

const StoreSchema = z.object({
  devices: z.record(z.string(), DeviceSchema).default({}),
});

type Store = z.infer<typeof StoreSchema>;

/** In-memory token lookup cache (avoids disk read on every chat.message). */
const TOKEN_CACHE_TTL_MS = 60_000;
type TokenCacheEntry = { device: ConsoleDevice; cachedUntil: number };
const tokenCache = new Map<string, TokenCacheEntry>();

function tokenCacheKey(storePath: string, deviceToken: string): string {
  return `${storePath}\0${deviceToken}`;
}

function invalidateTokenCache(storePath: string, deviceToken?: string): void {
  if (deviceToken) {
    tokenCache.delete(tokenCacheKey(storePath, deviceToken));
    return;
  }
  const prefix = `${storePath}\0`;
  for (const key of tokenCache.keys()) {
    if (key.startsWith(prefix)) tokenCache.delete(key);
  }
}

/** Test helper — clears the token cache. */
export function clearDeviceTokenCache(): void {
  tokenCache.clear();
}

function emptyStore(): Store {
  return { devices: {} };
}

async function readStore(path: string): Promise<Store> {
  try {
    const raw = await readFile(path, "utf8");
    return StoreSchema.parse(JSON.parse(raw));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return emptyStore();
    throw err;
  }
}

async function writeStore(path: string, store: Store): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  const body = JSON.stringify(StoreSchema.parse(store), null, 2);
  await writeFile(tmp, body, "utf8");
  await rename(tmp, path);
}

export function newDeviceToken(): string {
  return randomBytes(32).toString("hex");
}

export function isDeviceExpired(
  device: ConsoleDevice,
  now: Date = new Date(),
): boolean {
  const exp = Date.parse(device.expiresAt);
  return !Number.isFinite(exp) || exp <= now.getTime();
}

export async function listDevices(storePath: string): Promise<ConsoleDevice[]> {
  const store = await readStore(storePath);
  return Object.values(store.devices).sort((a, b) =>
    a.pairedAt.localeCompare(b.pairedAt),
  );
}

export async function upsertDevice(
  storePath: string,
  device: ConsoleDevice,
): Promise<ConsoleDevice> {
  const parsed = DeviceSchema.parse(device);
  const store = await readStore(storePath);
  const prev = store.devices[parsed.deviceId];
  if (prev?.deviceToken && prev.deviceToken !== parsed.deviceToken) {
    invalidateTokenCache(storePath, prev.deviceToken);
  }
  store.devices[parsed.deviceId] = parsed;
  await writeStore(storePath, store);
  invalidateTokenCache(storePath, parsed.deviceToken);
  return parsed;
}

export async function getValidDeviceByToken(
  storePath: string,
  deviceToken: string,
  now: Date = new Date(),
): Promise<ConsoleDevice | null> {
  if (!deviceToken.trim()) return null;
  const key = tokenCacheKey(storePath, deviceToken);
  const hit = tokenCache.get(key);
  if (hit && hit.cachedUntil > now.getTime()) {
    if (isDeviceExpired(hit.device, now)) {
      tokenCache.delete(key);
      return null;
    }
    return hit.device;
  }

  const store = await readStore(storePath);
  for (const device of Object.values(store.devices)) {
    if (device.deviceToken !== deviceToken) continue;
    if (isDeviceExpired(device, now)) {
      tokenCache.delete(key);
      return null;
    }
    tokenCache.set(key, {
      device,
      cachedUntil: now.getTime() + TOKEN_CACHE_TTL_MS,
    });
    return device;
  }
  tokenCache.delete(key);
  return null;
}

export async function getValidDeviceById(
  storePath: string,
  deviceId: string,
  now: Date = new Date(),
): Promise<ConsoleDevice | null> {
  const store = await readStore(storePath);
  const device = store.devices[deviceId];
  if (!device || isDeviceExpired(device, now)) return null;
  return device;
}

export async function revokeDevice(
  storePath: string,
  deviceId: string,
): Promise<boolean> {
  const store = await readStore(storePath);
  const existing = store.devices[deviceId];
  if (!existing) return false;
  delete store.devices[deviceId];
  await writeStore(storePath, store);
  invalidateTokenCache(storePath, existing.deviceToken);
  return true;
}

export async function revokeAllDevices(storePath: string): Promise<number> {
  const store = await readStore(storePath);
  const n = Object.keys(store.devices).length;
  store.devices = {};
  await writeStore(storePath, store);
  invalidateTokenCache(storePath);
  return n;
}

export async function purgeExpiredDevices(
  storePath: string,
  now: Date = new Date(),
): Promise<number> {
  const store = await readStore(storePath);
  let removed = 0;
  for (const [id, device] of Object.entries(store.devices)) {
    if (isDeviceExpired(device, now)) {
      delete store.devices[id];
      invalidateTokenCache(storePath, device.deviceToken);
      removed += 1;
    }
  }
  if (removed > 0) await writeStore(storePath, store);
  return removed;
}
