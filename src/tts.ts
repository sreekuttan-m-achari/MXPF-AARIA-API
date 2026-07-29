import { spawn, type ChildProcess } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { freemem, homedir, totalmem, tmpdir } from "node:os";
import { join } from "node:path";

import { applySpeechPronunciations } from "./spoken.js";

export type TtsEngine = "piper" | "spd-say" | "off";

type ProbeResult = {
  engine: TtsEngine;
  piperModel?: string;
  player?: string;
};

let probe: ProbeResult | null = null;
let active: ChildProcess | null = null;
let activePlayer: ChildProcess | null = null;
let activeTempDir: string | null = null;
let warmupPromise: Promise<{ ok: boolean; engine: TtsEngine; ms: number }> | null =
  null;
let lastWarmAt = 0;
let cachedChimePath: string | null = null;
/** Runtime mute override; null = follow AARIA_VOICE env / default. */
let runtimeVoiceOverride: boolean | null = null;

/** FIFO of utterances to speak without interrupting the current one. */
let speechQueue: string[] = [];
let draining = false;
/** Bumped on interrupt so late exit handlers from killed procs are ignored. */
let utteranceGen = 0;

/** Long-lived Piper process with model kept in memory. */
let persistentPiper: ChildProcess | null = null;
let persistentStartPromise: Promise<boolean> | null = null;
/** Forwards PCM from persistent Piper; null = discard (idle / warmup). */
let pcmForward: ((chunk: Buffer) => void) | null = null;


function which(bin: string): string | null {
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(":")) {
    if (!dir) continue;
    const full = join(dir, bin);
    try {
      accessSync(full, constants.X_OK);
      return full;
    } catch {
      /* continue */
    }
  }
  return null;
}

function voiceEnabledFromEnv(): boolean {
  const raw = process.env.AARIA_VOICE?.trim();
  if (raw === "0" || raw?.toLowerCase() === "false" || raw?.toLowerCase() === "off") {
    return false;
  }
  if (raw === "1" || raw?.toLowerCase() === "true" || raw?.toLowerCase() === "on") {
    return true;
  }
  // Default: on when a backend exists (decided at probe time)
  return true;
}

/** Effective voice preference (runtime toggle wins over env). */
export function isVoiceEnabled(): boolean {
  if (runtimeVoiceOverride !== null) return runtimeVoiceOverride;
  return voiceEnabledFromEnv();
}

export type VoiceStatus = {
  enabled: boolean;
  engine: TtsEngine;
  source: "runtime" | "env" | "default";
};

export function getVoiceStatus(): VoiceStatus {
  const enabled = isVoiceEnabled();
  let source: VoiceStatus["source"] = "default";
  if (runtimeVoiceOverride !== null) {
    source = "runtime";
  } else {
    const raw = process.env.AARIA_VOICE?.trim();
    if (raw) source = "env";
  }
  return {
    enabled,
    engine: enabled ? getTtsEngine() : "off",
    source,
  };
}

/** Toggle or set spoken replies on/off without restarting the API. */
export function setVoiceEnabled(on: boolean): VoiceStatus {
  runtimeVoiceOverride = on;
  if (!on) {
    stopSpeech();
    destroyPersistentPiper();
    console.error("[aria-voice] muted (runtime)");
  } else {
    // Re-probe if we started muted or previously marked off
    if (!probe || probe.engine === "off") {
      probe = null;
      initTts();
    }
    console.error(`[aria-voice] unmuted (runtime) engine=${getTtsEngine()}`);
  }
  return getVoiceStatus();
}

export function toggleVoice(): VoiceStatus {
  return setVoiceEnabled(!isVoiceEnabled());
}

function voiceEnabled(): boolean {
  return isVoiceEnabled();
}

function preferredEngine(): "auto" | "piper" | "spd-say" {
  const raw = process.env.AARIA_TTS?.trim().toLowerCase();
  if (raw === "piper" || raw === "spd-say") return raw;
  return "auto";
}

function findPiperModel(): string | null {
  const configured = process.env.AARIA_PIPER_MODEL?.trim();
  if (configured && existsSync(configured)) return configured;

  const candidates = [
    join(homedir(), ".local", "share", "piper"),
    join(homedir(), ".local", "share", "piper", "voices"),
    "/usr/share/piper-voices",
    "/opt/piper/models",
  ];

  for (const dir of candidates) {
    if (!existsSync(dir)) continue;
    const found = findOnnxRecursive(dir, 3, preferLowPiperVoice());
    if (found) return found;
  }
  return null;
}

/**
 * Prefer lighter ONNX voices when the host is RAM-constrained.
 * Override with AARIA_PIPER_QUALITY=low|medium.
 */
function preferLowPiperVoice(): boolean {
  const raw = process.env.AARIA_PIPER_QUALITY?.trim().toLowerCase();
  if (raw === "low") return true;
  if (raw === "medium" || raw === "high") return false;
  // Auto: <5 GiB total or <1.2 GiB free → low (model load is brutal under pressure).
  try {
    return totalmem() < 5 * 1024 ** 3 || freemem() < 1.2 * 1024 ** 3;
  } catch {
    return false;
  }
}

function findOnnxRecursive(
  dir: string,
  depth: number,
  preferLow: boolean,
): string | null {
  if (depth < 0) return null;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  const onnx = entries.filter((e) => e.endsWith(".onnx")).sort();
  const pickPreferred = (list: string[]): string | undefined => {
    if (preferLow) {
      return (
        list.find((e) => e.includes("en_GB") && e.includes("low")) ??
        list.find((e) => e.includes("en_US") && e.includes("low")) ??
        list.find((e) => e.includes("low")) ??
        list.find((e) => e.includes("en_GB") && e.includes("medium")) ??
        list.find((e) => e.includes("medium")) ??
        list[0]
      );
    }
    // ARIA default: British female medium (FRIDAY-like), then US female medium
    return (
      list.find((e) => e.includes("en_GB") && e.includes("cori") && e.includes("medium")) ??
      list.find((e) => e.includes("en_GB") && e.includes("alba") && e.includes("medium")) ??
      list.find((e) => e.includes("en_GB") && e.includes("medium")) ??
      list.find((e) => e.includes("kristin") && e.includes("medium")) ??
      list.find((e) => e.includes("amy") && e.includes("medium")) ??
      list.find((e) => e.includes("hfc_female") && e.includes("medium")) ??
      list.find((e) => e.includes("lessac") && e.includes("medium")) ??
      list.find((e) => e.includes("medium")) ??
      list[0]
    );
  };
  const preferred = pickPreferred(onnx);
  if (preferred) return join(dir, preferred);
  for (const e of entries) {
    const full = join(dir, e);
    try {
      if (!statSync(full).isDirectory()) continue;
      const nested = findOnnxRecursive(full, depth - 1, preferLow);
      if (nested) return nested;
    } catch {
      /* skip */
    }
  }
  return null;
}

function findPlayer(): string | null {
  // Linux: Pulse/PipeWire/ALSA. macOS: afplay (WAV path only).
  return which("paplay") ?? which("pw-play") ?? which("aplay") ?? which("afplay");
}

function canUsePiper(): { model: string; player: string } | null {
  if (!which("piper")) return null;
  const model = findPiperModel();
  if (!model) return null;
  const player = findPlayer();
  if (!player) return null;
  return { model, player };
}

function canUseSpdSay(): boolean {
  return Boolean(which("spd-say"));
}

function spdLanguage(): string {
  return process.env.AARIA_SPD_LANGUAGE?.trim() || "en-GB";
}

/** Named synthesis voice (-y). Falls back to voice type (-t). */
function spdVoiceArgs(): string[] {
  const named = process.env.AARIA_SPD_VOICE?.trim();
  if (named) {
    return ["-y", named];
  }
  const voiceType =
    process.env.AARIA_SPD_VOICE_TYPE?.trim() || "female1";
  return ["-t", voiceType];
}

function spdVoiceLabel(): string {
  const named = process.env.AARIA_SPD_VOICE?.trim();
  if (named) return `${named} (${spdLanguage()})`;
  const voiceType =
    process.env.AARIA_SPD_VOICE_TYPE?.trim() || "female1";
  return `${voiceType} (${spdLanguage()})`;
}

/** spd-say rate -100..100; negative = slower. Default -20 for composed pace. */
function spdSayRate(): number {
  const raw = process.env.AARIA_SPD_RATE?.trim();
  const n = raw ? Number.parseInt(raw, 10) : -20;
  if (!Number.isFinite(n)) return -20;
  return Math.min(100, Math.max(-100, n));
}

/** Piper length-scale: >1 slower. Default 1 — clear, brisk FRIDAY pace. */
function piperLengthScale(): number {
  const raw = process.env.AARIA_PIPER_LENGTH_SCALE?.trim();
  const n = raw ? Number.parseFloat(raw) : 1;
  if (!Number.isFinite(n)) return 1;
  return Math.min(2, Math.max(0.5, n));
}

/** Pause between sentences (seconds). Default 0 — Piper silence gaps often hiss. */
function piperSentenceSilence(): number {
  const raw = process.env.AARIA_PIPER_SENTENCE_SILENCE?.trim();
  const n = raw ? Number.parseFloat(raw) : 0;
  if (!Number.isFinite(n)) return 0;
  return Math.min(2, Math.max(0, n));
}

/** Optional generator noise (lower = less hiss). Model default ~0.667. */
function piperNoiseScale(): number | undefined {
  const raw = process.env.AARIA_PIPER_NOISE_SCALE?.trim();
  if (!raw) return undefined;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(2, Math.max(0, n));
}

/** Use WAV file playback (slower). Default: stream raw audio for lower latency. */
function piperPreferWav(): boolean {
  const raw = process.env.AARIA_PIPER_WAV?.trim();
  return raw === "1" || raw?.toLowerCase() === "true";
}

/**
 * Keep Piper loaded across utterances (default on).
 * Set AARIA_PIPER_PERSISTENT=0 to restore one-shot spawn per speak.
 */
function piperPersistentEnabled(): boolean {
  const raw = process.env.AARIA_PIPER_PERSISTENT?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") {
    return false;
  }
  return true;
}

/** Piper reads line-oriented stdin — collapse newlines so one utterance = one line. */
function collapseSpeechLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Idle gap after PCM stops → end of current utterance (model still loaded). */
function piperPcmIdleMs(): number {
  const raw = process.env.AARIA_PIPER_PCM_IDLE_MS?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 280;
  return Number.isFinite(n) && n >= 80 ? n : 280;
}

function piperBaseArgs(model: string): string[] {
  const args = [
    "--model",
    model,
    "--length-scale",
    String(piperLengthScale()),
    "--sentence-silence",
    String(piperSentenceSilence()),
  ];
  const noise = piperNoiseScale();
  if (noise !== undefined) {
    args.push("--noise-scale", String(noise));
  }
  return args;
}

function piperPlayerRawArgs(playerBin: string): string[] {
  const playerName = playerBin.split("/").pop() ?? playerBin;
  if (playerName === "paplay") {
    return ["--raw", "--rate=22050", "--channels=1", "--format=s16le"];
  }
  if (playerName === "pw-play") {
    return ["--rate", "22050", "--channels", "1", "--format", "s16"];
  }
  return ["-r", "22050", "-f", "S16_LE", "-t", "raw", "-"];
}

/**
 * Synthesize a short silent warmup (no playback) and wait for completion
 * so ONNX + page cache are hot before the first user-facing utterance.
 * Used when persistent mode is off or failed to start.
 */
function warmupPiperOnce(model: string): Promise<void> {
  const wav = join(tmpdir(), `aria-piper-warmup-${process.pid}-${Date.now()}.wav`);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      try {
        rmSync(wav, { force: true });
      } catch {
        /* ignore */
      }
      resolve();
    };

    const child = spawn(
      "piper",
      [...piperBaseArgs(model), "-f", wav],
      { stdio: ["pipe", "ignore", "ignore"] },
    );
    // Slightly longer than "ok" so more of the model path is exercised.
    child.stdin?.on("error", () => {
      /* EPIPE during warmup — ignore */
    });
    safeWrite(child.stdin, "Systems online.");
    safeEnd(child.stdin);

    child.on("exit", finish);
    child.on("error", finish);
    // First Cori load can be slow; only force-kill if truly hung.
    setTimeout(() => {
      if (settled) return;
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }, 45_000);
  });
}

function destroyPersistentPiper(): void {
  pcmForward = null;
  const proc = persistentPiper;
  persistentPiper = null;
  if (!proc) return;
  try {
    proc.stdin?.end();
  } catch {
    /* ignore */
  }
  killProc(proc);
}

function persistentPiperAlive(): boolean {
  return Boolean(
    persistentPiper &&
      persistentPiper.exitCode === null &&
      !persistentPiper.killed &&
      persistentPiper.stdin &&
      persistentPiper.stdout,
  );
}

/**
 * Wait until Piper stdout goes idle after producing audio (end of one line synth).
 * Cold load: allow long first wait; after bytes arrive, use short idle gap.
 */
function waitPiperPcmIdle(opts?: {
  maxMs?: number;
  requireBytes?: boolean;
}): Promise<{ bytes: number }> {
  const maxMs = opts?.maxMs ?? 45_000;
  const requireBytes = opts?.requireBytes ?? true;
  const idleMs = piperPcmIdleMs();

  return new Promise((resolve) => {
    let bytes = 0;
    let settled = false;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let maxTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (idleTimer) clearTimeout(idleTimer);
      if (maxTimer) clearTimeout(maxTimer);
      if (pcmForward === onData) pcmForward = null;
      resolve({ bytes });
    };

    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (!requireBytes || bytes > 0) finish();
      }, idleMs);
    };

    const onData = (chunk: Buffer) => {
      bytes += chunk.length;
      armIdle();
    };

    pcmForward = onData;
    // If bytes already flowing isn't the case — start idle only after data,
    // or resolve on max timeout for hung synth.
    maxTimer = setTimeout(finish, maxMs);
    if (!requireBytes) armIdle();
  });
}

/** Write one line to persistent Piper and discard PCM until idle. */
async function persistentSynthDiscard(text: string): Promise<number> {
  if (!persistentPiperAlive()) return 0;
  const line = collapseSpeechLine(text);
  if (!line) return 0;
  const wait = waitPiperPcmIdle({ maxMs: 45_000, requireBytes: true });
  safeWrite(persistentPiper!.stdin, `${line}\n`);
  const { bytes } = await wait;
  return bytes;
}

async function ensurePersistentPiper(model: string): Promise<boolean> {
  if (persistentPiperAlive()) {
    return true;
  }
  if (persistentStartPromise) {
    return persistentStartPromise;
  }

  persistentStartPromise = (async () => {
    try {
      destroyPersistentPiper();
      const piper = spawn(
        "piper",
        [...piperBaseArgs(model), "--output-raw"],
        { stdio: ["pipe", "pipe", "ignore"] },
      );
      persistentPiper = piper;

      ignorePipeErrors(piper.stdin);
      ignorePipeErrors(piper.stdout);
      piper.stdout?.on("data", (chunk: Buffer) => {
        pcmForward?.(chunk);
      });
      piper.once("exit", (code, signal) => {
        if (persistentPiper === piper) {
          persistentPiper = null;
          console.error(
            `[aria-voice] persistent piper exited code=${code ?? "?"} signal=${signal ?? ""}`,
          );
        }
      });
      piper.once("error", (err) => {
        console.error("[aria-voice] persistent piper error:", err.message);
        if (persistentPiper === piper) persistentPiper = null;
      });

      // Force ONNX load; discard audio.
      const bytes = await persistentSynthDiscard("Systems online.");
      if (!persistentPiperAlive()) {
        return false;
      }
      console.error(
        `[aria-voice] persistent piper ready (warmup pcm ${bytes} bytes)`,
      );
      return true;
    } catch (err) {
      console.error(
        "[aria-voice] persistent piper start failed:",
        err instanceof Error ? err.message : err,
      );
      destroyPersistentPiper();
      return false;
    } finally {
      persistentStartPromise = null;
    }
  })();

  return persistentStartPromise;
}

function scheduleBackgroundWarmup(_model: string): void {
  void warmVoice(false).catch(() => undefined);
}

/**
 * Awaitable voice warmup — called from TUI boot and optional /voice/warmup.
 * Dedupes concurrent callers; skips if warmed within the last 60s.
 * With persistent Piper, this loads the model once into a long-lived child.
 */
export async function warmVoice(force = false): Promise<{
  ok: boolean;
  engine: TtsEngine;
  ms: number;
  skipped?: boolean;
}> {
  const engine = getTtsEngine();
  if (engine === "off") {
    return { ok: false, engine, ms: 0, skipped: true };
  }

  if (!force && lastWarmAt > 0 && Date.now() - lastWarmAt < 60_000) {
    return { ok: true, engine, ms: 0, skipped: true };
  }

  if (warmupPromise) {
    return warmupPromise;
  }

  const started = Date.now();
  warmupPromise = (async () => {
    try {
      if (engine === "piper" && probe?.piperModel) {
        if (piperPersistentEnabled() && !piperPreferWav()) {
          const ok = await ensurePersistentPiper(probe.piperModel);
          if (!ok) {
            console.error(
              "[aria-voice] persistent start failed — falling back to one-shot warmup",
            );
            await warmupPiperOnce(probe.piperModel);
          }
        } else {
          await warmupPiperOnce(probe.piperModel);
        }
      }
      lastWarmAt = Date.now();
      const ms = Date.now() - started;
      console.error(`[aria-voice] warmup complete (${ms}ms)`);
      return { ok: true, engine, ms };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[aria-voice] warmup failed: ${msg}`);
      return { ok: false, engine, ms: Date.now() - started };
    } finally {
      warmupPromise = null;
    }
  })();

  return warmupPromise;
}

function cleanupTempDir(): void {
  if (!activeTempDir) return;
  try {
    rmSync(activeTempDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  activeTempDir = null;
}

/** Probe once and cache. Safe to call multiple times. */
export function initTts(): TtsEngine {
  if (probe) return probe.engine;

  if (!voiceEnabled()) {
    probe = { engine: "off" };
    console.error("[aria-voice] disabled (AARIA_VOICE=0)");
    return "off";
  }

  const prefer = preferredEngine();
  const piper = canUsePiper();
  const spd = canUseSpdSay();

  if (prefer === "piper") {
    if (piper) {
      probe = { engine: "piper", piperModel: piper.model, player: piper.player };
    } else {
      probe = { engine: "off" };
      console.error(
        "[aria-voice] AARIA_TTS=piper but piper/model/player unavailable; voice off",
      );
      return "off";
    }
  } else if (prefer === "spd-say") {
    if (spd) {
      probe = { engine: "spd-say" };
    } else {
      probe = { engine: "off" };
      console.error(
        "[aria-voice] AARIA_TTS=spd-say but spd-say unavailable; voice off",
      );
      return "off";
    }
  } else if (piper) {
    probe = { engine: "piper", piperModel: piper.model, player: piper.player };
  } else if (spd) {
    probe = { engine: "spd-say" };
  } else {
    probe = { engine: "off" };
  }

  if (probe.engine === "piper") {
    const playerName = (probe.player ?? "").split("/").pop() ?? "";
    const streamMode =
      piperPreferWav() || playerName === "afplay" ? "wav" : "stream";
    const persist =
      piperPersistentEnabled() && streamMode === "stream"
        ? "persistent"
        : "oneshot";
    const quality = preferLowPiperVoice() ? "low-prefer" : "medium-prefer";
    console.error(
      `[aria-voice] engine=piper model=${probe.piperModel} player=${probe.player} mode=${streamMode}/${persist} quality=${quality} length_scale=${piperLengthScale()} sentence_silence=${piperSentenceSilence()}s`,
    );
    if (probe.piperModel) {
      scheduleBackgroundWarmup(probe.piperModel);
    }
  } else if (probe.engine === "spd-say") {
    console.error(`[aria-voice] engine=spd-say voice=${spdVoiceLabel()}`);
  } else {
    console.error("[aria-voice] engine=off (no piper/spd-say backend)");
  }

  return probe.engine;
}

export function getTtsEngine(): TtsEngine {
  return probe?.engine ?? initTts();
}

function killProc(proc: ChildProcess | null): void {
  if (!proc || proc.killed) return;
  try {
    proc.kill("SIGTERM");
  } catch {
    /* ignore */
  }
}

/** Ignore broken-pipe / reset — common when paplay/piper exits under memory pressure. */
function isBenignPipeError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === "EPIPE" || code === "ECONNRESET" || code === "ERR_STREAM_DESTROYED";
}

function ignorePipeErrors(stream: NodeJS.EventEmitter | null | undefined): void {
  if (!stream) return;
  stream.on("error", (err: unknown) => {
    if (isBenignPipeError(err)) return;
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[aria-voice] stream error:", msg);
  });
}

function safeWrite(
  stream: NodeJS.WritableStream | null | undefined,
  data: string | Buffer,
): boolean {
  if (!stream) return false;
  const writable = stream as NodeJS.WritableStream & {
    destroyed?: boolean;
    writable?: boolean;
  };
  if (writable.destroyed || writable.writable === false) return false;
  try {
    return stream.write(data);
  } catch (err) {
    if (!isBenignPipeError(err)) {
      console.error(
        "[aria-voice] write failed:",
        err instanceof Error ? err.message : err,
      );
    }
    return false;
  }
}

function safeEnd(stream: NodeJS.WritableStream | null | undefined): void {
  if (!stream) return;
  try {
    stream.end();
  } catch {
    /* ignore */
  }
}

/** Stop any in-flight playback and clear the queue (keeps persistent Piper). */
export function stopSpeech(): void {
  speechQueue = [];
  draining = false;
  utteranceGen += 1;
  const discardGen = utteranceGen;
  killProc(activePlayer);
  killProc(active);
  activePlayer = null;
  active = null;
  cleanupTempDir();
  // Discard any PCM still arriving from the living Piper so the next line is clean.
  if (persistentPiperAlive()) {
    pcmForward = () => {
      /* discard */
    };
    setTimeout(() => {
      if (utteranceGen === discardGen) {
        pcmForward = null;
      }
    }, Math.max(400, piperPcmIdleMs() * 2));
  } else {
    pcmForward = null;
  }
}

function speakSpdSay(text: string, gen: number, onDone: () => void): void {
  const rate = spdSayRate();
  const args = [
    "--wait",
    "-l",
    spdLanguage(),
    ...spdVoiceArgs(),
    ...(rate !== 0 ? ["-r", String(rate)] : []),
    text,
  ];
  const child = spawn("spd-say", args, {
    stdio: ["ignore", "ignore", "ignore"],
  });
  active = child;
  const finish = () => {
    if (gen !== utteranceGen) return;
    if (active === child) active = null;
    onDone();
  };
  child.on("exit", finish);
  child.on("error", (err) => {
    console.error("[aria-voice] spd-say error:", err.message);
    finish();
  });
}

function speakPiperRaw(
  text: string,
  model: string,
  playerBin: string,
  gen: number,
  onDone: () => void,
): void {
  const piper = spawn(
    "piper",
    [...piperBaseArgs(model), "--output-raw"],
    { stdio: ["pipe", "pipe", "ignore"] },
  );
  const player = spawn(playerBin, piperPlayerRawArgs(playerBin), {
    stdio: ["pipe", "ignore", "ignore"],
  });

  active = piper;
  activePlayer = player;

  ignorePipeErrors(piper.stdin);
  ignorePipeErrors(piper.stdout);
  ignorePipeErrors(player.stdin);
  if (piper.stdout && player.stdin) {
    piper.stdout.pipe(player.stdin, { end: true });
  }
  safeWrite(piper.stdin, text);
  safeEnd(piper.stdin);

  let piperDone = false;
  let playerDone = false;
  const maybeFinish = () => {
    if (gen !== utteranceGen) return;
    if (!piperDone || !playerDone) return;
    if (active === piper) active = null;
    if (activePlayer === player) activePlayer = null;
    onDone();
  };

  piper.on("exit", (code) => {
    if (code !== 0 && gen === utteranceGen && active === piper) {
      console.error(`[aria-voice] piper exited code=${code ?? "?"}`);
    }
    piperDone = true;
    safeEnd(player.stdin);
    maybeFinish();
  });
  player.on("exit", () => {
    playerDone = true;
    maybeFinish();
  });
  piper.on("error", (err) => {
    if (!isBenignPipeError(err)) {
      console.error("[aria-voice] piper error:", err.message);
    }
    piperDone = true;
    playerDone = true;
    killProc(player);
    maybeFinish();
  });
  player.on("error", (err) => {
    if (!isBenignPipeError(err)) {
      console.error("[aria-voice] player error:", err.message);
    }
    playerDone = true;
    piperDone = true;
    killProc(piper);
    maybeFinish();
  });
}

function speakPiperWav(
  text: string,
  model: string,
  playerBin: string,
  gen: number,
  onDone: () => void,
): void {
  cleanupTempDir();
  const dir = mkdtempSync(join(tmpdir(), "aria-voice-"));
  activeTempDir = dir;
  const wavPath = join(dir, "speech.wav");

  const piperArgs = [...piperBaseArgs(model), "-f", wavPath];
  const piper = spawn("piper", piperArgs, {
    stdio: ["pipe", "ignore", "ignore"],
  });
  active = piper;

  ignorePipeErrors(piper.stdin);
  safeWrite(piper.stdin, text);
  safeEnd(piper.stdin);

  piper.on("exit", (code, signal) => {
    if (gen !== utteranceGen) return;
    if (active === piper) active = null;
    if (code !== 0) {
      console.error(
        `[aria-voice] piper exited code=${code ?? "?"} signal=${signal ?? ""}`,
      );
      cleanupTempDir();
      onDone();
      return;
    }
    if (!existsSync(wavPath)) {
      console.error("[aria-voice] piper produced no wav output");
      cleanupTempDir();
      onDone();
      return;
    }
    const player = spawn(playerBin, [wavPath], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    activePlayer = player;
    player.on("exit", () => {
      if (gen !== utteranceGen) return;
      if (activePlayer === player) activePlayer = null;
      cleanupTempDir();
      onDone();
    });
    player.on("error", (err) => {
      console.error("[aria-voice] player error:", err.message);
      if (gen !== utteranceGen) return;
      if (activePlayer === player) activePlayer = null;
      cleanupTempDir();
      onDone();
    });
  });

  piper.on("error", (err) => {
    console.error("[aria-voice] piper error:", err.message);
    if (gen !== utteranceGen) return;
    if (active === piper) active = null;
    cleanupTempDir();
    onDone();
  });
}

function speakPiperPersistent(
  text: string,
  model: string,
  playerBin: string,
  gen: number,
  onDone: () => void,
): void {
  void (async () => {
    const ok = await ensurePersistentPiper(model);
    if (gen !== utteranceGen) {
      onDone();
      return;
    }
    if (!ok || !persistentPiperAlive()) {
      console.error(
        "[aria-voice] persistent unavailable — one-shot fallback for utterance",
      );
      speakPiperRaw(text, model, playerBin, gen, onDone);
      return;
    }

    killProc(activePlayer);
    activePlayer = null;

    // Drop leftover PCM from a cancelled utterance before writing the next line.
    pcmForward = () => {
      /* discard */
    };
    await new Promise<void>((r) => setTimeout(r, piperPcmIdleMs()));
    if (gen !== utteranceGen) {
      onDone();
      return;
    }

    const player = spawn(playerBin, piperPlayerRawArgs(playerBin), {
      stdio: ["pipe", "ignore", "ignore"],
    });
    activePlayer = player;
    ignorePipeErrors(player.stdin);

    let settled = false;
    let gotData = false;
    let doneCalled = false;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let maxTimer: ReturnType<typeof setTimeout> | undefined;

    const doneOnce = () => {
      if (doneCalled) return;
      doneCalled = true;
      if (activePlayer === player) activePlayer = null;
      onDone();
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      if (idleTimer) clearTimeout(idleTimer);
      if (maxTimer) clearTimeout(maxTimer);
      if (pcmForward === onPcm) pcmForward = null;
      safeEnd(player.stdin);
      let playerEnded = false;
      player.once("exit", () => {
        playerEnded = true;
        doneOnce();
      });
      player.once("error", () => {
        playerEnded = true;
        doneOnce();
      });
      setTimeout(() => {
        if (!playerEnded) {
          killProc(player);
          doneOnce();
        }
      }, 2_000);
    };

    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (gen !== utteranceGen) {
          finish();
          return;
        }
        if (gotData) finish();
      }, piperPcmIdleMs());
    };

    const onPcm = (chunk: Buffer) => {
      if (gen !== utteranceGen) return;
      gotData = true;
      if (!safeWrite(player.stdin, chunk)) {
        // Player closed mid-stream — stop forwarding and finish.
        finish();
        return;
      }
      armIdle();
    };

    pcmForward = onPcm;
    maxTimer = setTimeout(() => {
      console.error("[aria-voice] persistent utterance timed out");
      finish();
    }, 60_000);

    if (!safeWrite(persistentPiper!.stdin, `${collapseSpeechLine(text)}\n`)) {
      console.error("[aria-voice] persistent write failed — respawning piper");
      destroyPersistentPiper();
      finish();
      return;
    }
  })();
}

function speakPiper(
  text: string,
  model: string,
  playerBin: string,
  gen: number,
  onDone: () => void,
): void {
  const playerName = playerBin.split("/").pop() ?? playerBin;
  // afplay cannot consume raw PCM on stdin — always use a temp WAV.
  if (piperPreferWav() || playerName === "afplay") {
    speakPiperWav(text, model, playerBin, gen, onDone);
    return;
  }
  if (piperPersistentEnabled()) {
    speakPiperPersistent(text, model, playerBin, gen, onDone);
    return;
  }
  speakPiperRaw(text, model, playerBin, gen, onDone);
}

function startUtterance(text: string, onDone: () => void): void {
  if (!isVoiceEnabled()) {
    onDone();
    return;
  }
  const engine = getTtsEngine();
  if (engine === "off") {
    onDone();
    return;
  }
  const line = applySpeechPronunciations(text.trim());
  if (!line) {
    onDone();
    return;
  }

  const gen = utteranceGen;
  try {
    if (engine === "piper" && probe?.piperModel && probe.player) {
      speakPiper(line, probe.piperModel, probe.player, gen, onDone);
      return;
    }
    if (engine === "spd-say") {
      speakSpdSay(line, gen, onDone);
      return;
    }
    onDone();
  } catch (err) {
    console.error(
      "[aria-voice] speak failed:",
      err instanceof Error ? err.message : err,
    );
    onDone();
  }
}

function drainQueue(): void {
  if (draining) return;
  const next = speechQueue.shift();
  if (!next) return;
  draining = true;
  startUtterance(next, () => {
    draining = false;
    drainQueue();
  });
}

/**
 * Queue text to speak after the current utterance (does not interrupt).
 * Use for mid-stream reply sentences so speech stays in order with print.
 */
export function enqueueSpeech(text: string): void {
  if (!isVoiceEnabled()) return;
  const line = applySpeechPronunciations(text.trim());
  if (!line) return;
  if (getTtsEngine() === "off") return;
  speechQueue.push(line);
  drainQueue();
}

/**
 * Speak text immediately, replacing any current utterance and clearing the queue.
 * Use for cancel, mute, greetings, and explicit interrupts.
 */
export function speak(text: string): void {
  if (!isVoiceEnabled()) return;
  const engine = getTtsEngine();
  if (engine === "off") return;
  const line = applySpeechPronunciations(text.trim());
  if (!line) return;

  speechQueue = [];
  utteranceGen += 1;
  const discardGen = utteranceGen;
  killProc(activePlayer);
  killProc(active);
  activePlayer = null;
  active = null;
  cleanupTempDir();
  if (persistentPiperAlive()) {
    pcmForward = () => {
      /* discard */
    };
    setTimeout(() => {
      if (utteranceGen === discardGen) pcmForward = null;
    }, piperPcmIdleMs());
  } else {
    pcmForward = null;
  }

  draining = true;
  startUtterance(line, () => {
    draining = false;
    drainQueue();
  });
}

/** Soft sine chime WAV (cached) — no Piper needed. */
function ensureDoneChimeWav(): string | null {
  if (cachedChimePath && existsSync(cachedChimePath)) {
    return cachedChimePath;
  }
  try {
    const sampleRate = 22050;
    const durationSec = 0.13;
    const freq = 660;
    const n = Math.floor(sampleRate * durationSec);
    const pcm = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      const fadeIn = Math.min(1, i / (sampleRate * 0.015));
      const fadeOut = Math.min(1, (n - i) / (sampleRate * 0.045));
      const sample = Math.sin(2 * Math.PI * freq * t) * 0.14 * fadeIn * fadeOut;
      pcm.writeInt16LE(
        Math.max(-32767, Math.min(32767, Math.round(sample * 32767))),
        i * 2,
      );
    }
    const dataSize = pcm.length;
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(1, 22); // mono
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36);
    header.writeUInt32LE(dataSize, 40);

    const path = join(tmpdir(), `aria-done-chime-${process.pid}.wav`);
    writeFileSync(path, Buffer.concat([header, pcm]));
    cachedChimePath = path;
    return path;
  } catch (err) {
    console.error(
      "[aria-voice] chime wav failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Soft completion beep when a chat turn finishes (replaces spoken "Done, …").
 * Uses paplay/pw-play/aplay; no-ops if voice disabled or no player.
 */
export function playDoneChime(): void {
  if (!voiceEnabled()) return;
  // Prefer player from TTS probe; otherwise discover one for chime-only.
  const playerBin = probe?.player ?? findPlayer();
  if (!playerBin) return;

  const wav = ensureDoneChimeWav();
  if (!wav) return;

  stopSpeech();
  try {
    const player = spawn(playerBin, [wav], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    activePlayer = player;
    player.on("exit", () => {
      if (activePlayer === player) activePlayer = null;
    });
    player.on("error", (err) => {
      console.error("[aria-voice] chime player error:", err.message);
      if (activePlayer === player) activePlayer = null;
    });
  } catch (err) {
    console.error(
      "[aria-voice] chime failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

/** Short note for the agent persona about current voice setup. */
export function voiceCapabilitySummary(): string | undefined {
  if (!isVoiceEnabled()) return undefined;
  const engine = getTtsEngine();
  if (engine === "off") return undefined;
  const model =
    probe?.piperModel?.split("/").pop()?.replace(".onnx", "") ?? engine;
  return [
    "## Voice (runtime)",
    "",
    "Local TTS is enabled on this desktop.",
    `Engine: ${engine}${engine === "piper" ? ` (${model})` : ""}.`,
    "Spoken accent/tone: British English, calm and composed — FRIDAY-like.",
    "Piper keeps the voice model loaded in a persistent process after warmup.",
    "On TUI open, the startup greeting may be spoken aloud.",
    "While streaming, speak each new assistant sentence as it lands (queued).",
    "Never speak the user’s message back.",
    "When the turn finishes, only speak leftover assistant text not already queued.",
    "Listening / microphone is not available yet.",
  ].join("\n");
}

/** Test helper: reset cached probe (not for production). */
export function _resetTtsProbeForTests(): void {
  stopSpeech();
  destroyPersistentPiper();
  probe = null;
  runtimeVoiceOverride = null;
}
