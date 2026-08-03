import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  commandLabel,
  completeLine,
  inlineSuggestion,
  isBareSkillCommand,
  isFilesCommand,
  isMemoryCommand,
  isSkillCommand,
  isSkillsCommand,
  isVoiceCommand,
  listCompletions,
  matchFilesAtAgents,
  matchFilesLocalPath,
  matchFilesRemoteAgents,
  matchFilesRemotePath,
  parseFilesCommand,
  parseSkillCommand,
  pickSuggestion,
  resolveCommand,
  setFilesAgentIds,
  shortcutOf,
  SLASH_COMMANDS,
} from "../tui/commands.js";
import { completeLocalPath } from "../tui/files/fs.js";

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

  it("Tab-completes /files @minion ids", () => {
    setFilesAgentIds([
      "astra-demo",
      "astra-vmi548194",
      "astra-winmagictoys-prod",
    ]);
    assert.deepEqual(matchFilesAtAgents("/files @"), [
      "astra-demo",
      "astra-vmi548194",
      "astra-winmagictoys-prod",
    ]);
    assert.deepEqual(matchFilesAtAgents("/f @astra-v"), ["astra-vmi548194"]);
    assert.deepEqual(matchFilesAtAgents("/browse @astra-win"), [
      "astra-winmagictoys-prod",
    ]);
    assert.equal(matchFilesAtAgents("/files remote"), null);
    assert.deepEqual(completeLine("/files @astra-v"), [
      ["@astra-vmi548194"],
      "@astra-v",
    ]);
    // Tab returns a single preferred match (inline ghost accept)
    assert.deepEqual(completeLine("/f @"), [["@astra-demo"], "@"]);
    assert.deepEqual(listCompletions("/f @")[0], [
      "@astra-demo",
      "@astra-vmi548194",
      "@astra-winmagictoys-prod",
    ]);
  });

  it("Tab-completes /files remote agent ids", () => {
    setFilesAgentIds(["astra-demo", "astra-vmi548194"]);
    assert.deepEqual(matchFilesRemoteAgents("/files remote "), [
      "astra-demo",
      "astra-vmi548194",
    ]);
    assert.deepEqual(matchFilesRemoteAgents("/files remote astra-v"), [
      "astra-vmi548194",
    ]);
    assert.equal(matchFilesRemoteAgents("/files remote /var"), null);
    assert.deepEqual(completeLine("/files remote astra-v"), [
      ["astra-vmi548194"],
      "astra-v",
    ]);
    // Bare `remote` (no trailing space) is not agent-complete yet
    assert.deepEqual(completeLine("/files remote"), [[], "/files remote"]);
  });

  it("offers inline ghost suffixes for commands and paths", async () => {
    assert.deepEqual(inlineSuggestion("/fil"), {
      completion: "/files",
      token: "/fil",
      suffix: "es",
    });
    assert.deepEqual(pickSuggestion(["/files", "/fil"], "/fil"), {
      completion: "/files",
      token: "/fil",
      suffix: "es",
    });
    assert.equal(inlineSuggestion("/files"), null);

    setFilesAgentIds(["astra-demo", "astra-vmi548194"]);
    assert.deepEqual(inlineSuggestion("/files @astra-v"), {
      completion: "@astra-vmi548194",
      token: "@astra-v",
      suffix: "mi548194",
    });

    const base = await mkdtemp(path.join(tmpdir(), "aaria-files-complete-"));
    await mkdir(path.join(base, "alpha-dir"));
    await writeFile(path.join(base, "alpha-file.txt"), "x");
    await writeFile(path.join(base, "beta.txt"), "y");

    const prefix = path.join(base, "alpha");
    const hits = completeLocalPath(prefix);
    assert.ok(hits.some((h) => h.endsWith(`alpha-dir${path.sep}`) || h.endsWith("alpha-dir/")));
    assert.ok(hits.some((h) => h.endsWith("alpha-file.txt")));
    assert.ok(!hits.some((h) => h.includes("beta")));

    assert.equal(matchFilesLocalPath(`/files ${prefix}`), prefix);
    assert.equal(matchFilesLocalPath("/files remote /var"), null);
    assert.equal(matchFilesLocalPath("/files @astra-demo /var"), null);

    const [kwHits, kwToken] = completeLine("/files rem");
    assert.equal(kwToken, "rem");
    assert.deepEqual(kwHits, ["remote"]);
    assert.deepEqual(inlineSuggestion("/files rem"), {
      completion: "remote",
      token: "rem",
      suffix: "ote",
    });

    assert.deepEqual(matchFilesRemotePath("/files @astra-demo /var/ww"), {
      agentId: "astra-demo",
      pathPrefix: "/var/ww",
    });
    assert.deepEqual(
      matchFilesRemotePath("/files remote astra-demo /var/ww"),
      { agentId: "astra-demo", pathPrefix: "/var/ww" },
    );
    // Sync completer leaves remote paths for the async main wrapper
    assert.deepEqual(completeLine("/files @astra-demo /var/ww"), [
      [],
      "/var/ww",
    ]);
  });
});
