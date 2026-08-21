import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  resolveClaudeModelId,
  resolveRuntimeKind,
} from "../runtime/kind.js";

const ENV_KEYS = [
  "AARIA_RUNTIME",
  "AARIA_MODEL",
  "AARIA_CLAUDE_MODEL",
  "AARIA_LEARN_MODEL",
] as const;

const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> =
  {};

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (key in saved) {
      const v = saved[key];
      if (v === undefined) delete process.env[key];
      else process.env[key] = v;
      delete saved[key];
    }
  }
});

function setEnv(key: (typeof ENV_KEYS)[number], value: string | undefined) {
  if (!(key in saved)) saved[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("resolveRuntimeKind", () => {
  it("defaults to cursor", () => {
    setEnv("AARIA_RUNTIME", undefined);
    assert.equal(resolveRuntimeKind(), "cursor");
  });

  it("accepts claude and anthropic aliases", () => {
    setEnv("AARIA_RUNTIME", "claude");
    assert.equal(resolveRuntimeKind(), "claude");
    setEnv("AARIA_RUNTIME", "anthropic");
    assert.equal(resolveRuntimeKind(), "claude");
    setEnv("AARIA_RUNTIME", "Claude");
    assert.equal(resolveRuntimeKind(), "claude");
  });

  it("accepts mxpf aliases", () => {
    setEnv("AARIA_RUNTIME", "mxpf");
    assert.equal(resolveRuntimeKind(), "mxpf");
    setEnv("AARIA_RUNTIME", "maximprof");
    assert.equal(resolveRuntimeKind(), "mxpf");
  });

  it("falls back to cursor for unknown values", () => {
    setEnv("AARIA_RUNTIME", "openrouter");
    assert.equal(resolveRuntimeKind(), "cursor");
  });
});

describe("resolveClaudeModelId", () => {
  it("maps Cursor-ish model ids to Claude default", () => {
    setEnv("AARIA_CLAUDE_MODEL", undefined);
    setEnv("AARIA_MODEL", "default");
    assert.equal(resolveClaudeModelId(), "claude-sonnet-4-5");
    setEnv("AARIA_MODEL", "composer-2.5");
    assert.equal(resolveClaudeModelId(), "claude-sonnet-4-5");
  });

  it("honors AARIA_CLAUDE_MODEL override", () => {
    setEnv("AARIA_MODEL", "default");
    setEnv("AARIA_CLAUDE_MODEL", "claude-opus-4-5");
    assert.equal(resolveClaudeModelId(), "claude-opus-4-5");
  });

  it("passes through explicit Claude model ids", () => {
    setEnv("AARIA_MODEL", "claude-haiku-4-5");
    assert.equal(resolveClaudeModelId(), "claude-haiku-4-5");
  });
});
