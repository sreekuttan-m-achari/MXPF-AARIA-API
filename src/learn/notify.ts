export type LearnNotification = {
  target: "memory" | "user";
  preview: string;
  staged?: boolean;
  pendingId?: string;
};

type Listener = (event: LearnNotification) => void;

const listeners = new Set<Listener>();

export function onLearnNotification(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitLearnNotification(event: LearnNotification): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (err) {
      console.error("[learn] notification listener failed:", err);
    }
  }
}
