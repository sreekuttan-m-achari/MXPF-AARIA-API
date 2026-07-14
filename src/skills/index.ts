import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

import { agentCwd } from "../persona.js";

export type SkillMeta = {
  name: string;
  description: string;
  path: string;
  version?: string;
};

export type SkillWriteResult =
  | { ok: true; name: string; path: string }
  | { ok: false; error: string };

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function skillsRoot(cwd: string = agentCwd()): string {
  const override = process.env.AARIA_SKILLS_PATH?.trim();
  return override ? resolve(cwd, override) : resolve(cwd, "skills");
}

function parseFrontmatter(raw: string): {
  meta: Record<string, string>;
  body: string;
} {
  const match = FRONTMATTER_RE.exec(raw.trim());
  if (!match) {
    return { meta: {}, body: raw.trim() };
  }

  const meta: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line
      .slice(idx + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (key) meta[key] = value;
  }

  return { meta, body: match[2]!.trim() };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function findSkillFile(dir: string, name: string): string | undefined {
  const direct = join(dir, name, "SKILL.md");
  if (existsSync(direct)) return direct;

  const flat = join(dir, `${name}.md`);
  if (existsSync(flat)) return flat;

  if (!existsSync(dir)) return undefined;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = join(dir, entry.name, "SKILL.md");
    if (!existsSync(candidate)) continue;
    try {
      const raw = readFileSync(candidate, "utf8");
      const { meta } = parseFrontmatter(raw);
      if (meta.name === name || entry.name === name) {
        return candidate;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

export function listSkills(cwd: string = agentCwd()): SkillMeta[] {
  const root = skillsRoot(cwd);
  if (!existsSync(root)) {
    return [];
  }

  const skills: SkillMeta[] = [];
  const seen = new Set<string>();

  const add = (path: string) => {
    try {
      const raw = readFileSync(path, "utf8");
      const { meta } = parseFrontmatter(raw);
      const name = meta.name?.trim() || slugify(path.split("/").slice(-2, -1)[0] ?? "skill");
      if (seen.has(name)) return;
      seen.add(name);
      skills.push({
        name,
        description: meta.description?.trim() || "(no description)",
        path,
        version: meta.version?.trim(),
      });
    } catch {
      // skip unreadable skill
    }
  };

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const skillFile = join(root, entry.name, "SKILL.md");
      if (existsSync(skillFile)) add(skillFile);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      add(join(root, entry.name));
    }
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export function loadSkillContent(
  name: string,
  cwd: string = agentCwd(),
): string | undefined {
  const path = findSkillFile(skillsRoot(cwd), name);
  if (!path) return undefined;
  try {
    const raw = readFileSync(path, "utf8");
    const { meta, body } = parseFrontmatter(raw);
    const title = meta.name?.trim() || name;
    const desc = meta.description?.trim();
    const header = desc
      ? `# Skill: ${title}\n\n${desc}\n\n`
      : `# Skill: ${title}\n\n`;
    return `${header}${body}`.trim();
  } catch {
    return undefined;
  }
}

export function formatSkillsIndex(cwd: string = agentCwd()): string | undefined {
  const skills = listSkills(cwd);
  if (skills.length === 0) return undefined;

  const lines = skills.map(
    (s) => `- **${s.name}** — ${s.description}`,
  );
  return [
    "Installed skills (load with /skill <name> or mention in chat):",
    "",
    ...lines,
  ].join("\n");
}

export function expandWithSkill(
  message: string,
  cwd: string = agentCwd(),
): string {
  const match = message.match(/^\/skill\s+(\S+)(?:\s+([\s\S]*))?$/i);
  if (!match) return message;

  const name = match[1]!;
  const rest = match[2]?.trim() ?? "";
  const skill = loadSkillContent(name, cwd);
  if (!skill) {
    return message;
  }

  const parts = [
    "Apply the following skill for this turn. Follow its procedures.",
    "",
    "---",
    "",
    skill,
    "",
    "---",
  ];
  if (rest) {
    parts.push("", "User request:", rest);
  }
  return parts.join("\n");
}

export function writeSkill(
  name: string,
  description: string,
  body: string,
  cwd: string = agentCwd(),
): SkillWriteResult {
  const normalized = name.trim();
  if (!normalized) {
    return { ok: false, error: "skill name required" };
  }
  if (description.length > 300) {
    return { ok: false, error: "description too long (max 300)" };
  }
  if (body.length > 4000) {
    return { ok: false, error: "skill body too long (max 4000)" };
  }

  const root = skillsRoot(cwd);
  const dir = join(root, slugify(normalized));
  const path = join(dir, "SKILL.md");
  if (existsSync(path)) {
    return { ok: false, error: `skill already exists: ${normalized}` };
  }

  mkdirSync(dir, { recursive: true });
  const content = [
    "---",
    `name: ${normalized}`,
    `description: "${description.replace(/"/g, '\\"')}"`,
    "author: AARIA",
    "---",
    "",
    body.trim(),
    "",
  ].join("\n");
  writeFileSync(path, content, "utf8");
  return { ok: true, name: normalized, path };
}

export function skillsStatus(cwd: string = agentCwd()): {
  path: string;
  count: number;
  names: string[];
} {
  const skills = listSkills(cwd);
  return {
    path: skillsRoot(cwd),
    count: skills.length,
    names: skills.map((s) => s.name),
  };
}
