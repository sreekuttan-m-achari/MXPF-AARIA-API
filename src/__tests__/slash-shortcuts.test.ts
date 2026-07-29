import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  commandLabel,
  isBareSkillCommand,
  isMemoryCommand,
  isSkillCommand,
  isSkillsCommand,
  isVoiceCommand,
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
});
