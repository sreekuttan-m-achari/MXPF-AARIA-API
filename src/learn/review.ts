import type { AriaAgent } from "../agent.js";
import { withAgentBusyRecovery } from "../agent-busy.js";
import { enqueueAgentWork } from "../agent-queue.js";
import { agentCwd } from "../persona.js";
import { createStreamingCollector } from "../stream.js";
import { runCurator, shouldRunCurator } from "./curator.js";
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
import { getReviewAgent } from "./review-agent.js";
import { writeSkill } from "../skills/index.js";

export type ReviewEntry = {
  target: MemoryTarget | "skill";
  content: string;
  skillDescription?: string;
  skillBody?: string;
};

function isLearnReviewEnabled(): boolean {
  const v = process.env.AARIA_LEARN_REVIEW?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no") {
    return false;
  }
  return true;
}

function digestReply(text: string, max = 800): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}… [${trimmed.length} chars total]`;
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
    "Save to target `skill` when a reusable procedure/workflow was established (name + description + markdown body).",
    "",
    "SKIP: ephemeral debugging, one-off commands, secrets/tokens, obvious trivia, things already listed.",
    "Max 2 entries. Each content ≤200 chars for memory/user. Skills: name in content, plus skillDescription (≤200) and skillBody (≤1500 markdown).",
    "",
    "Reply with ONLY valid JSON (no markdown fences):",
    '{"entries":[{"target":"memory"|"user"|"skill","content":"...","skillDescription":"...","skillBody":"..."}]}',
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
    `Assistant: ${digestReply(assistantReply)}`,
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
      entries?: Array<{
        target?: string;
        content?: string;
        skillDescription?: string;
        skillBody?: string;
      }>;
    };
    if (!Array.isArray(parsed.entries)) {
      return [];
    }
    const out: ReviewEntry[] = [];
    for (const e of parsed.entries.slice(0, 2)) {
      const content = e.content?.trim();
      if (!content) continue;
      if (e.target === "skill") {
        const body = e.skillBody?.trim();
        const desc = e.skillDescription?.trim() || content;
        if (body) {
          out.push({
            target: "skill",
            content,
            skillDescription: desc,
            skillBody: body,
          });
        }
        continue;
      }
      const target =
        e.target === "user" ? "user" : e.target === "memory" ? "memory" : null;
      if (target) {
        out.push({ target, content });
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function applyReviewEntry(
  entry: ReviewEntry,
  cwd: string,
): Promise<{ ok: boolean; preview: string; target: string; staged?: boolean; pendingId?: string }> {
  if (entry.target === "skill") {
    const result = writeSkill(
      entry.content,
      entry.skillDescription ?? entry.content,
      entry.skillBody ?? "",
      cwd,
    );
    return result.ok
      ? { ok: true, preview: entry.content, target: "skill" }
      : { ok: false, preview: result.error, target: "skill" };
  }

  const approval = isLearnApprovalRequired();
  if (approval) {
    const staged = stageLearnEntry(entry.target, entry.content, cwd);
    return {
      ok: true,
      preview: entry.content,
      target: entry.target,
      staged: true,
      pendingId: staged.id,
    };
  }

  let result = applyLearnEntry(entry.target, entry.content, cwd);
  if (!result.ok && result.error.includes("consolidate or remove")) {
    if (shouldRunCurator(cwd)) {
      const curated = await runCurator(cwd);
      if (curated.ok) {
        result = applyLearnEntry(entry.target, entry.content, cwd);
      }
    }
  }

  return result.ok
    ? { ok: true, preview: result.preview, target: entry.target }
    : { ok: false, preview: result.error, target: entry.target };
}

async function runReviewOnce(
  userMessage: string,
  assistantReply: string,
): Promise<void> {
  const cwd = agentCwd();
  const prompt = buildReviewPrompt(userMessage, assistantReply, cwd);
  const collector = createStreamingCollector();
  const agent = await getReviewAgent();

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
    if (shouldRunCurator(cwd)) {
      void enqueueAgentWork(async () => {
        try {
          await runCurator(cwd);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[curator] scheduled prune failed: ${msg}`);
        }
      });
    }
    return;
  }

  for (const entry of entries) {
    const result = await applyReviewEntry(entry, cwd);
    if (result.ok) {
      emitLearnNotification({
        target: result.target as MemoryTarget | "skill",
        preview: result.preview,
        staged: result.staged,
        pendingId: result.pendingId,
      });
      console.error(
        `[learn] ${result.staged ? "staged" : "saved"} (${result.target}): ${result.preview}`,
      );
    } else {
      console.error(`[learn] skip (${result.target}): ${result.preview}`);
    }
  }
}

/** Queue a post-turn learn review (Hermes-style). Does not block the caller. */
export function scheduleLearnReview(
  _agent: AriaAgent,
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
      await runReviewOnce(user, reply);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[learn] review failed: ${msg}`);
    }
  });
}

export function learnReviewEnabled(): boolean {
  return isLearnReviewEnabled();
}
