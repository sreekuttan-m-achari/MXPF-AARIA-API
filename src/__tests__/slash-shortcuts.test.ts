import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  commandLabel,
  isBareSkillCommand,
  isFilesCommand,
  isMemoryCommand,
  isSkillCommand,
  isSkillsCommand,
  isVoiceCommand,
  parseFilesCommand,
  parseSkillCommand,
  resolveCommand,
  shortcutOf,
  SLASH_COMMANDS,
} from "../tui/commands.js";

describe("slash command shortcuts", () => {
  it("maps each short alias to the canonical command", () => {
    const expected: Record<string, string> = {
      "/h": "/help",
      "/hl": "/health",
      "/o": "/ops",
      "/f": "/files",
      "/browse": "/files",
      "/m": "/memory",
      "/ss": "/skills",
      "/sk": "/skill",
      "/c": "/cancel",
      "/v": "/voice",
      "/n": "/new",
      "/q": "/quit",
      "/exit": "/quit",
      "/reset": "/new",
    };
    for (const [alias, name] of Object.entries(expected)) {
      assert.equal(resolveCommand(alias)?.name, name, alias);
    }
  });

  it("builds help labels with bracketed shortcuts", () => {
    const byName = Object.fromEntries(
      SLASH_COMMANDS.map((cmd) => [cmd.name, commandLabel(cmd)]),
    );
    assert.equal(byName["/help"], "/help[/h]");
    assert.equal(byName["/health"], "/health[/hl]");
    assert.equal(byName["/ops"], "/ops[/o]");
    assert.equal(byName["/files"], "/files[/f]");
    assert.equal(byName["/memory"], "/memory[/m]");
    assert.equal(byName["/skills"], "/skills[/ss]");
    assert.equal(byName["/skill"], "/skill[/sk]");
    assert.equal(byName["/cancel"], "/cancel[/c]");
    assert.equal(byName["/voice"], "/voice[/v]");
    assert.equal(byName["/new"], "/new[/n]");
    assert.equal(byName["/quit"], "/quit[/q]");
  });

  it("picks the short alias for display, not /exit or /reset", () => {
    const quit = SLASH_COMMANDS.find((c) => c.name === "/quit")!;
    const neu = SLASH_COMMANDS.find((c) => c.name === "/new")!;
    assert.equal(shortcutOf(quit), "/q");
    assert.equal(shortcutOf(neu), "/n");
  });

  it("accepts /m and /sk /v prefixes for subcommands", () => {
    assert.equal(isMemoryCommand("/m"), true);
    assert.equal(isMemoryCommand("/m pending"), true);
    assert.equal(isSkillsCommand("/ss"), true);
    assert.equal(isBareSkillCommand("/sk"), true);
    assert.equal(isSkillCommand("/sk work-desk-ops"), true);
    assert.equal(isVoiceCommand("/v"), true);
    assert.equal(isVoiceCommand("/v off"), true);
  });

  it("parses /sk the same as /skill", () => {
    assert.deepEqual(parseSkillCommand("/sk foo bar baz"), {
      name: "foo",
      prompt: "bar baz",
    });
    assert.deepEqual(parseSkillCommand("/skill foo"), {
      name: "foo",
      prompt: "",
    });
  });

  it("accepts /files aliases and optional start path", () => {
    assert.equal(isFilesCommand("/files"), true);
    assert.equal(isFilesCommand("/f"), true);
    assert.equal(isFilesCommand("/browse"), true);
    assert.equal(isFilesCommand("/files ~/WORKS"), true);
    assert.equal(isFilesCommand("/f C:\\Users"), true);
    assert.deepEqual(parseFilesCommand("/files"), { mode: "local" });
    assert.deepEqual(parseFilesCommand("/f ~/src"), {
      mode: "local",
      startPath: "~/src",
    });
    assert.deepEqual(parseFilesCommand("/browse /tmp"), {
      mode: "local",
      startPath: "/tmp",
    });
  });

  it("parses /files remote and @agent forms", () => {
    assert.deepEqual(parseFilesCommand("/files remote"), { mode: "remote" });
    assert.deepEqual(parseFilesCommand("/files remote astra-vmi548194"), {
      mode: "remote",
      agentId: "astra-vmi548194",
    });
    assert.deepEqual(
      parseFilesCommand("/files remote astra-vmi548194 /var/www"),
      {
        mode: "remote",
        agentId: "astra-vmi548194",
        startPath: "/var/www",
      },
    );
    assert.deepEqual(parseFilesCommand("/files remote /var/www"), {
      mode: "remote",
      startPath: "/var/www",
    });
    assert.deepEqual(parseFilesCommand("/f @astra-demo ~/x"), {
      mode: "remote",
      agentId: "astra-demo",
      startPath: "~/x",
    });
  });
});
