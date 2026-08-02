import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  displayPath,
  expandUserPath,
  listEntries,
  parentDir,
  resolveStartDir,
} from "../tui/files/fs.js";
import { homedir } from "node:os";

describe("file browser fs helpers", () => {
  it("expands ~ via os.homedir (cross-platform)", () => {
    assert.equal(expandUserPath("~"), homedir());
    assert.equal(expandUserPath("~/Documents"), path.join(homedir(), "Documents"));
    assert.equal(
      expandUserPath("~\\Documents"),
      path.join(homedir(), "Documents"),
    );
  });

  it("parentDir stops at filesystem root", () => {
    const root = path.parse(process.cwd()).root;
    assert.equal(parentDir(root), null);
    const child = path.join(root, "a", "b");
    assert.equal(parentDir(child), path.join(root, "a"));
  });

  it("displayPath uses ~ when under home", () => {
    const under = path.join(homedir(), "x", "y");
    assert.equal(displayPath(homedir()), "~");
    assert.equal(displayPath(under), `~${path.sep}x${path.sep}y`);
  });

  it("lists dirs before files with absolute paths", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "aaria-files-"));
    await mkdir(path.join(base, "subdir"));
    await writeFile(path.join(base, "a.txt"), "hi");
    await writeFile(path.join(base, ".secret"), "no");

    const visible = await listEntries(base, { showHidden: false });
    assert.equal(visible.some((e) => e.name === ".secret"), false);
    assert.equal(visible[0]?.name, "subdir");
    assert.equal(visible[0]?.isDirectory, true);
    assert.equal(visible[0]?.absolutePath, path.join(base, "subdir"));
    assert.ok(visible.some((e) => e.name === "a.txt" && !e.isDirectory));

    const all = await listEntries(base, { showHidden: true });
    assert.ok(all.some((e) => e.name === ".secret"));
  });

  it("resolveStartDir falls back for missing paths", async () => {
    const missing = path.join(tmpdir(), "aaria-no-such-dir-xyz");
    const resolved = await resolveStartDir(missing);
    assert.equal(resolved, process.cwd());
  });

  it("resolveStartDir accepts a file by using its parent", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "aaria-files-"));
    const file = path.join(base, "readme.md");
    await writeFile(file, "x");
    assert.equal(await resolveStartDir(file), base);
  });

  it("detects symlinks when the platform supports them", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "aaria-files-"));
    const target = path.join(base, "target.txt");
    await writeFile(target, "x");
    const link = path.join(base, "link.txt");
    try {
      await symlink(target, link);
    } catch {
      // Windows may require elevated privileges for symlinks — skip.
      return;
    }
    const entries = await listEntries(base, { showHidden: true });
    const found = entries.find((e) => e.name === "link.txt");
    assert.ok(found);
    assert.equal(found!.isSymlink, true);
    assert.equal(found!.isDirectory, false);
  });
});
