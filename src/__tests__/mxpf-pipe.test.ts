import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { resolveMxpfProvider } from "../runtime/mxpf-pipe.js";

const ENV_KEYS = ["MXPF_HARNESS_PROVIDER", "AARIA_MXPF_PROVIDER"] as const;
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

describe("resolveMxpfProvider", () => {
  it("honors explicit openai / anthropic env", () => {
    setEnv("MXPF_HARNESS_PROVIDER", "openai");
    assert.equal(resolveMxpfProvider("https://api.anthropic.com"), "openai");
    setEnv("MXPF_HARNESS_PROVIDER", "anthropic");
    assert.equal(resolveMxpfProvider("http://127.0.0.1:11434/v1"), "anthropic");
  });

  it("maps openrouter / ollama / lmstudio / vllm / colibri host hints to openai", () => {
    setEnv("MXPF_HARNESS_PROVIDER", undefined);
    setEnv("AARIA_MXPF_PROVIDER", undefined);
    assert.equal(
      resolveMxpfProvider("https://openrouter.ai/api/v1"),
      "openai",
    );
    assert.equal(
      resolveMxpfProvider("http://127.0.0.1:11434/v1"),
      "openai",
    );
    assert.equal(
      resolveMxpfProvider("http://localhost:1234/v1"),
      "openai",
    );
    assert.equal(
      resolveMxpfProvider("http://vllm.local:8000/v1"),
      "openai",
    );
    assert.equal(
      resolveMxpfProvider("http://colibri.home:8000/v1"),
      "openai",
    );
  });

  it("maps common local ports without name hints to openai", () => {
    setEnv("MXPF_HARNESS_PROVIDER", undefined);
    assert.equal(resolveMxpfProvider("http://127.0.0.1:8000/v1"), "openai");
    assert.equal(resolveMxpfProvider("http://localhost:11434/v1"), "openai");
    assert.equal(resolveMxpfProvider("http://127.0.0.1:1234/v1"), "openai");
  });

  it("maps anthropic host to anthropic when env unset", () => {
    setEnv("MXPF_HARNESS_PROVIDER", undefined);
    assert.equal(
      resolveMxpfProvider("https://api.anthropic.com"),
      "anthropic",
    );
  });

  it("defaults to openai when unset", () => {
    setEnv("MXPF_HARNESS_PROVIDER", undefined);
    assert.equal(resolveMxpfProvider(undefined), "openai");
  });
});
