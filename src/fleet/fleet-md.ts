import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { agentCwd } from "../persona.js";
import type { AgentRecord } from "./registry-store.js";

const BEGIN = "<!-- FLEET:BEGIN -->";
const END = "<!-- FLEET:END -->";

export function renderFleetTable(agents: AgentRecord[]): string {
  const rows = agents.length
    ? agents.map((a) => {
        const labels = Object.entries(a.labels)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ");
        const caps = a.caps.join(", ");
        return `| ${a.agentId} | ${a.name ?? ""} | ${a.hostname ?? ""} | ${labels} | ${caps} | ${a.status} |`;
      })
    : ["| *(none)* | | | | | |"];

  return [
    BEGIN,
    "| Agent ID | Name | Host / site | Labels | Caps | Status |",
    "|----------|------|-------------|--------|------|--------|",
    ...rows,
    END,
  ].join("\n");
}

export async function syncFleetMarkdown(
  agents: AgentRecord[],
  cwd: string = agentCwd(),
): Promise<void> {
  const file = path.join(cwd, "FLEET.md");
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      text = `# ASTRA Fleet\n\n${BEGIN}\n${END}\n`;
    } else {
      throw err;
    }
  }

  const table = renderFleetTable(agents);
  const beginIdx = text.indexOf(BEGIN);
  const endIdx = text.indexOf(END);
  let next: string;
  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    next =
      text.slice(0, beginIdx) + table + text.slice(endIdx + END.length);
  } else {
    // Replace first markdown table under ## Minions if markers missing
    const minions = text.indexOf("## Minions");
    if (minions !== -1) {
      const after = text.slice(minions);
      const nextHeading = after.search(/\n## /);
      const sectionEnd =
        nextHeading === -1 ? text.length : minions + nextHeading;
      next =
        text.slice(0, minions) +
        `## Minions\n\n${table}\n` +
        text.slice(sectionEnd);
    } else {
      next = `${text.trimEnd()}\n\n## Minions\n\n${table}\n`;
    }
  }
  await writeFile(file, next.endsWith("\n") ? next : `${next}\n`, "utf8");
}
