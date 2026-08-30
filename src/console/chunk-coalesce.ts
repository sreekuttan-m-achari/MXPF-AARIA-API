/**
 * Coalesce stream tokens into fewer MQTT publishes.
 * Flushes on size threshold or idle timer (whichever comes first).
 */
export type ChunkCoalescer = {
  push: (text: string) => void;
  /** Drain buffer and wait for in-flight flushes. */
  flush: () => Promise<void>;
};

export function createChunkCoalescer(opts: {
  flush: (text: string) => Promise<void>;
  /** Max time to hold a partial buffer (default 80ms). */
  maxWaitMs?: number;
  /** Flush when buffered length reaches this (default 256). */
  maxChars?: number;
}): ChunkCoalescer {
  const maxWaitMs = opts.maxWaitMs ?? 80;
  const maxChars = opts.maxChars ?? 256;
  let buf = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();

  function clearTimer(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function enqueueFlush(): void {
    clearTimer();
    const text = buf;
    buf = "";
    if (!text) return;
    chain = chain
      .then(() => opts.flush(text))
      .catch((err) => {
        console.error("[console] chunk publish failed:", err);
      });
  }

  function schedule(): void {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      enqueueFlush();
    }, maxWaitMs);
    if (typeof timer === "object" && "unref" in timer) {
      (timer as NodeJS.Timeout).unref();
    }
  }

  return {
    push(text: string) {
      if (!text) return;
      buf += text;
      if (buf.length >= maxChars) {
        enqueueFlush();
      } else {
        schedule();
      }
    },
    async flush() {
      enqueueFlush();
      await chain;
    },
  };
}
