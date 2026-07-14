/** Session-local chat entries for the ops Chat panel (not persisted). */

export type ChatHistoryEntry = {
  id: string;
  at: string;
  role: "user" | "assistant";
  preview: string;
};

const MAX = 80;
const entries: ChatHistoryEntry[] = [];
let seq = 0;

function clip(text: string, max = 120): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= max) {
    return one;
  }
  return `${one.slice(0, max - 1)}…`;
}

export function pushChatHistory(role: "user" | "assistant", text: string): void {
  const preview = clip(text);
  if (!preview) {
    return;
  }
  seq += 1;
  entries.push({
    id: `c${seq}`,
    at: new Date().toISOString(),
    role,
    preview,
  });
  while (entries.length > MAX) {
    entries.shift();
  }
}

export function listChatHistory(): ChatHistoryEntry[] {
  return entries.slice();
}

export function clearChatHistory(): void {
  entries.length = 0;
}
