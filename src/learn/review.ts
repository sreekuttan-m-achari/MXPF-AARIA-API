import type { AriaAgent } from "../agent.js";
import { withAgentBusyRecovery } from "../agent-busy.js";
import { enqueueAgentWork } from "../agent-queue.js";
import { agentCwd } from "../persona.js";
import { createStreamingCollector } from "../stream.js";
import {
  applyLearnEntry,
  memoryContextForReview,
  type MemoryTarget,
} from "./memory-store.js";
import { emitLearnNotification } from "./notify.js";
import {
  isLearnApprovalRequired,
  stageLearnEntry,
} from "./pending.js";

export type ReviewEntry = {
  target: MemoryTarget;
  content: string;
};

function isLearnReviewEnabled(): boolean {
  const v = process.env.AARIA_LEARN_REVIEW?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no") {
    return false;
  }
  return true;
}

function buildReviewPrompt(
  userMessage: string,
  assistantReply: string,
  cwd: string,
): string {
  const { memoryEntries, userMarkdown } = memoryContextForReview(cwd);
  const memoryBlock =
    memoryEntries.length > 0
      ? memoryEntries.map((e) => `- ${e}`).join("\n")
      : "(empty)";

  return [
    "You are the background learn-review for AARIA (work-desk assistant).",
    "The user turn below already completed. Do NOT reply to the user.",
    "Decide if anything durable should be saved for FUTURE sessions.",
    "",
    "Save to target `memory` when it is environment/work fact (servers, paths, conventions, tooling).",
    "Save to target `user` when it is a user preference or correction about how they want to be helped.",
    "",
    "SKIP: ephemeral debugging, one-off commands, secrets/tokens, obvious trivia, things already listed.",
    "Max 2 entries. Each content ≤ 200 chars. Compact, information-dense.",
    "",
    "Reply with ONLY valid JSON (no markdown fences):",
    '{"entries":[{"target":"memory"|"user","content":"..."}]}',
    'Use {"entries":[]} when nothing should be saved.',
    "",
    "## Current MEMORY entries",
    memoryBlock,
    "",
    "## Current USER.md (reference)",
    userMarkdown?.slice(0, 1200) || "(none)",
    "",
    "## Turn to review",
    `User: ${userMessage}`,
    `Assistant: ${assistantReply.slice(0, 2000)}`,
  ].join("\n");
}

function parseReviewJson(text: string): ReviewEntry[] {
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return [];
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      entries?: Array<{ target?: string; content?: string }>;
    };
    if (!Array.isArray(parsed.entries)) {
      return [];
    }
    const out: ReviewEntry[] = [];
    for (const e of parsed.entries.slice(0, 2)) {
      const target = e.target === "user" ? "user" : e.target === "memory" ? "memory" : null;
      const content = e.content?.trim();
      if (target && content) {
        out.push({ target, content });
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function runReviewOnce(
  agent: AriaAgent,
  userMessage: string,
  assistantReply: string,
): Promise<void> {
  const cwd = agentCwd();
  const prompt = buildReviewPrompt(userMessage, assistantReply, cwd);
  const collector = createStreamingCollector();

  await withAgentBusyRecovery(agent.agentId, async () => {
    const run = await agent.send(prompt);
    for await (const event of run.stream()) {
      collector.handleEvent(event);
    }
    const result = await run.wait();
    if (result.status === "error") {
      console.error("[learn] review run failed");
      return;
    }
  });

  const entries = parseReviewJson(collector.getText());
  if (entries.length === 0) {
    return;
  }

  const approval = isLearnApprovalRequired();

  for (const entry of entries) {
    if (approval) {
      const staged = stageLearnEntry(entry.target, entry.content, cwd);
      emitLearnNotification({
        target: entry.target,
        preview: entry.content,
        staged: true,
        pendingId: staged.id,
      });
      console.error(
        `[learn] staged ${staged.id} (${entry.target}): ${entry.content}`,
      );
      continue;
    }

    const result = applyLearnEntry(entry.target, entry.content, cwd);
    if (result.ok) {
      emitLearnNotification({
        target: entry.target,
        preview: result.preview,
      });
      console.error(`[learn] saved (${entry.target}): ${result.preview}`);
    } else {
      console.error(`[learn] skip (${entry.target}): ${result.error}`);
    }
  }
}

/** Queue a post-turn learn review (Hermes-style). Does not block the caller. */
export function scheduleLearnReview(
  agent: AriaAgent,
  userMessage: string,
  assistantReply: string,
): void {
  if (!isLearnReviewEnabled()) {
    return;
  }
  const user = userMessage.trim();
  const reply = assistantReply.trim();
  if (!user || !reply) {
    return;
  }

  void enqueueAgentWork(async () => {
    try {
      await runReviewOnce(agent, user, reply);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[learn] review failed: ${msg}`);
    }
  });
}

export function learnReviewEnabled(): boolean {
  return isLearnReviewEnabled();
}
