import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  assertEditableFile,
  MAX_EDIT_BYTES,
  resolveEditor,
} from "../tui/files/editor.js";

describe("file browser editor helpers", () => {
  it("resolveEditor returns a non-empty command", () => {
    const prev = process.env.AARIA_EDITOR;
    process.env.AARIA_EDITOR = "nano";
    try {
      const editor = resolveEditor();
      assert.ok(editor.length > 0);
    } finally {
      if (prev === undefined) delete process.env.AARIA_EDITOR;
      else process.env.AARIA_EDITOR = prev;
    }
  });

  it("assertEditableFile accepts a normal text file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "aaria-edit-"));
    const file = path.join(dir, "note.txt");
    await writeFile(file, "hello");
    assert.doesNotThrow(() => assertEditableFile(file));
  });

  it("assertEditableFile rejects oversized files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "aaria-edit-"));
    const file = path.join(dir, "big.bin");
    await writeFile(file, Buffer.alloc(Math.min(MAX_EDIT_BYTES + 1, MAX_EDIT_BYTES + 1)));
    assert.throws(() => assertEditableFile(file), /too large/);
  });
});
