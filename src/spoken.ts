/** Build short spoken lines for ack/done (no LLM). */

export function voiceMaxChars(): number {
  const raw = process.env.AARIA_VOICE_MAX_CHARS?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 280;
  return Number.isFinite(n) && n > 20 ? n : 280;
}

function maxChars(): number {
  return voiceMaxChars();
}

/** Chars before we speak a provisional mid-stream clip (no sentence end yet). */
function provisionalChars(): number {
  const raw = process.env.AARIA_VOICE_PROVISIONAL_CHARS?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 72;
  return Number.isFinite(n) && n >= 24 ? n : 72;
}

function collapseWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Fix Piper/spd-say misreads for known names and labels.
 * e.g. "Sree" is often spoken as "S - ree" when capitalised.
 */
export function applySpeechPronunciations(input: string): string {
  let s = input;
  // Prefer phonetic "Shree" so English TTS keeps it as one syllable cluster.
  s = s.replace(/\bSree\b/gi, "Shree");
  // Avoid letter-spelling A·A·R·I·A / AARIA
  s = s.replace(/\bA\.?A\.?R\.?I\.?A\b/gi, "Aaria");
  s = s.replace(/\bARIA\b/g, "Aaria");
  return s;
}

/** Remove fenced code, inline code blocks of substance, and bare URLs for speaking. */
export function cleanForSpeech(input: string): string {
  let s = input;
  s = s.replace(/```[\s\S]*?```/g, " ");
  s = s.replace(/`[^`]+`/g, " ");
  s = s.replace(/https?:\/\/\S+/gi, " ");
  s = s.replace(/^#{1,6}\s+/gm, "");
  s = s.replace(/^\s*[-*+]\s+/gm, "");
  s = s.replace(/^\s*\d+\.\s+/gm, "");
  return collapseWs(applySpeechPronunciations(s));
}

function clipAtBoundary(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const sentenceEnd = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("? "),
    slice.lastIndexOf("! "),
  );
  if (sentenceEnd >= Math.floor(max * 0.4)) {
    return slice.slice(0, sentenceEnd + 1).trim();
  }
  const space = slice.lastIndexOf(" ");
  if (space >= Math.floor(max * 0.4)) {
    return slice.slice(0, space).trim();
  }
  return slice.trim();
}

/** Take up to several full sentences within a character budget. */
function firstSentences(text: string, max: number): string {
  const parts: string[] = [];
  const re = /[^.!?]+[.!?]+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    parts.push(match[0].trim());
  }
  if (parts.length === 0) {
    return clipAtBoundary(text, max);
  }
  let out = "";
  for (const part of parts) {
    const next = out ? `${out} ${part}` : part;
    if (next.length > max) break;
    out = next;
  }
  return out || clipAtBoundary(parts[0] ?? text, max);
}

function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  if (t.endsWith("?")) return true;
  return /^(what|why|how|when|where|who|which|can|could|should|is|are|do|does|did|will|would)\b/i.test(
    t,
  );
}

/**
 * Ack spoken at turn start from the user message.
 * e.g. "On it: fix the nginx config" or "Looking into: …"
 */
export function buildAckSpeech(userMessage: string): string {
  const cleaned = cleanForSpeech(userMessage);
  if (!cleaned) return "On it.";
  const body = clipAtBoundary(cleaned, maxChars());
  if (!body) return "On it.";
  const prefix = looksLikeQuestion(cleaned) ? "Looking into" : "On it";
  return `${prefix}: ${body}`;
}

/**
 * Spoken reply snippet (no "Done," prefix) — up to AARIA_VOICE_MAX_CHARS.
 */
export function buildReplySpeech(reply: string): string {
  const cleaned = cleanForSpeech(reply);
  if (!cleaned || !/[a-zA-Z0-9]/.test(cleaned)) return "";
  return firstSentences(cleaned, maxChars());
}

/**
 * First complete sentence only — early acknowledgement while streaming.
 */
export function buildAckLineSpeech(streamed: string): string {
  const cleaned = cleanForSpeech(streamed);
  if (!cleaned || !/[a-zA-Z0-9]/.test(cleaned)) return "";
  const match = cleaned.match(/^(.+?[.!?])(?:\s|$)/);
  return match?.[1]?.trim() ?? "";
}

/**
 * Done spoken after a successful turn from the assistant reply.
 * Up to a few sentences within AARIA_VOICE_MAX_CHARS; falls back to "Done."
 * @deprecated Prefer buildReplySpeech for ARIA (no Done prefix).
 */
export function buildDoneSpeech(reply: string): string {
  const body = buildReplySpeech(reply);
  if (!body) return "Done.";
  return `Done, ${body}`;
}

/**
 * Startup greeting / wish — speak the greeting itself (no "Done," prefix).
 */
export function buildGreetingSpeech(greeting: string): string {
  return buildReplySpeech(greeting);
}

/** True when streamed text has a speakable first sentence (for early TTS). */
export function hasSpeakableFirstSentence(text: string): boolean {
  const cleaned = cleanForSpeech(text);
  if (!cleaned || !/[a-zA-Z0-9]/.test(cleaned)) return false;
  return /^(.+?[.!?])(?:\s|$)/.test(cleaned);
}

function listCompleteSentences(cleaned: string): string[] {
  const parts: string[] = [];
  const re = /[^.!?]+[.!?]+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(cleaned)) !== null) {
    const s = match[0].trim();
    if (s && /[a-zA-Z0-9]/.test(s)) parts.push(s);
  }
  return parts;
}

/** Tracks which reply text has already been queued for TTS during a turn. */
export type StreamSpeechTracker = {
  spoken: string[];
  budgetUsed: number;
  provisional?: string;
};

export function createStreamSpeechTracker(): StreamSpeechTracker {
  return { spoken: [], budgetUsed: 0 };
}

function overlapsSpoken(line: string, tracker: StreamSpeechTracker): boolean {
  const norm = line.toLowerCase();
  if (tracker.spoken.some((s) => s.toLowerCase() === norm)) return true;
  if (tracker.provisional) {
    const p = tracker.provisional.toLowerCase();
    // Skip re-speaking when the finished sentence completes a provisional clip.
    if (norm.startsWith(p) || p.startsWith(norm.slice(0, Math.min(norm.length, p.length)))) {
      return true;
    }
  }
  return false;
}

/**
 * Pull new speakable units from streamed (or final) assistant text.
 * Speaks complete sentences as they appear; optionally a provisional clip
 * when the model stalls without punctuation; on finalize, speaks any leftover.
 */
export function pullStreamSpeech(
  streamed: string,
  tracker: StreamSpeechTracker,
  opts?: { finalize?: boolean },
): string[] {
  const cleaned = cleanForSpeech(streamed);
  if (!cleaned || !/[a-zA-Z0-9]/.test(cleaned)) return [];

  const max = maxChars();
  const out: string[] = [];
  const push = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed || overlapsSpoken(trimmed, tracker)) return;
    if (tracker.budgetUsed >= max) return;
    let piece = trimmed;
    if (tracker.budgetUsed + piece.length > max) {
      piece = clipAtBoundary(piece, max - tracker.budgetUsed);
      if (!piece) return;
    }
    tracker.spoken.push(piece);
    tracker.budgetUsed += piece.length + (tracker.spoken.length > 1 ? 1 : 0);
    out.push(piece);
  };

  for (const sentence of listCompleteSentences(cleaned)) {
    if (tracker.budgetUsed >= max) break;
    push(sentence);
  }

  if (tracker.spoken.length > 0) {
    tracker.provisional = undefined;
  } else if (
    !opts?.finalize &&
    !tracker.provisional &&
    cleaned.length >= provisionalChars()
  ) {
    const clip = clipAtBoundary(cleaned, Math.min(provisionalChars() + 24, max));
    if (clip) {
      tracker.provisional = clip;
      tracker.spoken.push(clip);
      tracker.budgetUsed += clip.length;
      out.push(clip);
    }
  }

  if (opts?.finalize && tracker.budgetUsed < max) {
    // Speak any trailing fragment that never got sentence punctuation.
    const spokenJoined = tracker.spoken.join(" ").toLowerCase();
    let remainder = cleaned;
    if (spokenJoined && cleaned.toLowerCase().startsWith(spokenJoined)) {
      remainder = cleaned.slice(spokenJoined.length).trim();
    } else {
      // Fall back: drop sentences we already covered.
      for (const s of tracker.spoken) {
        const idx = remainder.toLowerCase().indexOf(s.toLowerCase());
        if (idx >= 0) {
          remainder = remainder.slice(idx + s.length).trim();
        }
      }
    }
    if (remainder && /[a-zA-Z0-9]/.test(remainder)) {
      push(clipAtBoundary(remainder, max - tracker.budgetUsed));
    }
  }

  return out;
}
