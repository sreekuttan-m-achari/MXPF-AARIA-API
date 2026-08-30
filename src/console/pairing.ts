export type PendingPair = {
  deviceId: string;
  code: string;
  label: string;
  expiresAt: string;
  requestedAt: string;
};

function normalizeCode(code: string): string {
  return code.replace(/\D/g, "");
}

export function createPairingRegistry(pairTtlMs: number) {
  const pending = new Map<string, PendingPair>();

  function purgeExpired(now: Date = new Date()): void {
    const t = now.getTime();
    for (const [code, p] of pending) {
      if (Date.parse(p.expiresAt) <= t) pending.delete(code);
    }
  }

  return {
    register(input: {
      deviceId: string;
      code: string;
      label: string;
      now?: Date;
    }): PendingPair {
      purgeExpired(input.now);
      const code = normalizeCode(input.code);
      if (!/^\d{6}$/.test(code)) {
        throw new Error("pairing code must be 6 digits");
      }
      if (!input.deviceId.trim()) {
        throw new Error("deviceId required");
      }
      const now = input.now ?? new Date();
      // Replace any prior pending for same code or same device.
      for (const [c, p] of pending) {
        if (p.deviceId === input.deviceId) pending.delete(c);
      }
      const record: PendingPair = {
        deviceId: input.deviceId.trim(),
        code,
        label: input.label?.trim() || "Web console",
        expiresAt: new Date(now.getTime() + pairTtlMs).toISOString(),
        requestedAt: now.toISOString(),
      };
      pending.set(code, record);
      return record;
    },

    get(code: string, now: Date = new Date()): PendingPair | null {
      purgeExpired(now);
      return pending.get(normalizeCode(code)) ?? null;
    },

    take(code: string, now: Date = new Date()): PendingPair | null {
      purgeExpired(now);
      const key = normalizeCode(code);
      const p = pending.get(key) ?? null;
      if (p) pending.delete(key);
      return p;
    },

    deny(code: string, now: Date = new Date()): PendingPair | null {
      return this.take(code, now);
    },

    list(now: Date = new Date()): PendingPair[] {
      purgeExpired(now);
      return [...pending.values()].sort((a, b) =>
        a.requestedAt.localeCompare(b.requestedAt),
      );
    },

    clear(): void {
      pending.clear();
    },
  };
}

export type PairingRegistry = ReturnType<typeof createPairingRegistry>;
