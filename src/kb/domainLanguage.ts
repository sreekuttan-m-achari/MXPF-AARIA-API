/**
 * Optional domain-language loader (VIVA KB → Confluence fallback).
 *
 * Soft/optional only: with no VIVA/Confluence env, returns `{ text: "", source: "none" }`
 * and never fetches. Does not import or require the viva-ops skill.
 */

export type DomainLanguageResult = {
  text: string;
  source: "viva" | "confluence" | "none";
};

export type DomainLanguageScope = {
  jiraProject?: string;
  adoOrg?: string;
  adoProject?: string;
};

export type LoadDomainLanguageOptions = {
  fetchFn?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  maxChars?: number;
  /** Cap glossary/body fetches (default 8). */
  maxEntries?: number;
  /** Per-request timeout in ms (default 8000). */
  timeoutMs?: number;
};

const DEFAULT_MAX_CHARS = 4000;
const DEFAULT_MAX_ENTRIES = 8;
const DEFAULT_FETCH_TIMEOUT_MS = 8000;

/** Default Confluence space map aligned with VIVA dual-write defaults. */
const DEFAULT_SPACE_MAP = {
  global: "VIVAGLOBAL",
  adoOrgs: {
    digit9: "DIGIT9",
    luluorgpdd: "LULUORG",
    luluorg: "LULUORG",
    lulumizan: "LULUMIZAN",
    block9: "BLOCK9",
    "vistara-hub": "VIVAGLOBAL",
  } as Record<string, string>,
  jiraProjects: {
    D9: "DIGIT9",
    D9BE: "DIGIT9",
  } as Record<string, string>,
};

const CODING_ADJACENT_RE =
  /\b(code|coding|pr\b|pull.?request|repo|repository|implement|refactor|bug|fix|review|commit|branch|typescript|javascript|java|maven|dockerfile|k8s|kubernetes|diff|merge|lint|test(?:s|ing)?)\b/i;

export function isDomainLanguageConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isVivaConfigured(env) || isConfluenceConfigured(env);
}

export function isCodingAdjacentTurn(message: string): boolean {
  return CODING_ADJACENT_RE.test(message);
}

export function formatDomainLanguageBlock(result: DomainLanguageResult): string {
  if (!result.text.trim() || result.source === "none") return "";
  return ["## Domain language", result.text.trim()].join("\n");
}

/**
 * Load matching domain glossary text.
 * Prefer VIVA `GET /kb` when configured; on transport/5xx fall back to Confluence.
 * Unconfigured → no fetch. Failures never throw.
 */
export async function loadDomainLanguage(
  scope: DomainLanguageScope,
  opts: LoadDomainLanguageOptions = {},
): Promise<DomainLanguageResult> {
  const env = opts.env ?? process.env;
  const fetchFn = opts.fetchFn ?? fetch;
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;

  try {
    if (isVivaConfigured(env)) {
      const viva = await fetchFromViva(
        scope,
        env,
        fetchFn,
        maxChars,
        maxEntries,
        timeoutMs,
      );
      if (viva.ok) {
        return { text: viva.text, source: "viva" };
      }
      // transport / 5xx only → Confluence when configured
      if (viva.retryable && isConfluenceConfigured(env)) {
        const cf = await fetchFromConfluence(
          scope,
          env,
          fetchFn,
          maxChars,
          timeoutMs,
        );
        if (cf.ok && cf.text) {
          console.error(
            "[domain-language] VIVA /kb failed; using Confluence fallback",
          );
          return { text: cf.text, source: "confluence" };
        }
      }
      return { text: "", source: "none" };
    }

    if (isConfluenceConfigured(env)) {
      const cf = await fetchFromConfluence(
        scope,
        env,
        fetchFn,
        maxChars,
        timeoutMs,
      );
      if (cf.ok && cf.text) {
        return { text: cf.text, source: "confluence" };
      }
    }

    return { text: "", source: "none" };
  } catch {
    return { text: "", source: "none" };
  }
}

/**
 * Soft helper for desk turns: only fetches when optional KB is configured and
 * the message looks coding-/repo-aware. Failures return the original message.
 */
export async function maybeAugmentCodingTurn(
  message: string,
  scope: DomainLanguageScope = {},
  opts: LoadDomainLanguageOptions = {},
): Promise<string> {
  const env = opts.env ?? process.env;
  if (!isDomainLanguageConfigured(env)) return message;
  if (!isCodingAdjacentTurn(message)) return message;

  const result = await loadDomainLanguage(scope, { ...opts, env });
  const block = formatDomainLanguageBlock(result);
  if (!block) return message;
  return `${block}\n\n${message}`;
}

function isVivaConfigured(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env.AARIA_VIVA_KB_BASE_URL?.trim() && env.AARIA_VIVA_DASHBOARD_TOKEN?.trim(),
  );
}

function isConfluenceConfigured(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env.AARIA_CONFLUENCE_BASE_URL?.trim() &&
      env.AARIA_CONFLUENCE_EMAIL?.trim() &&
      env.AARIA_CONFLUENCE_TOKEN?.trim(),
  );
}

type FetchOk = { ok: true; text: string };
type FetchMiss = { ok: false; retryable: boolean };

async function fetchFromViva(
  scope: DomainLanguageScope,
  env: NodeJS.ProcessEnv,
  fetchFn: typeof fetch,
  maxChars: number,
  maxEntries: number,
  timeoutMs: number,
): Promise<FetchOk | FetchMiss> {
  const base = env.AARIA_VIVA_KB_BASE_URL!.trim().replace(/\/$/, "");
  const token = env.AARIA_VIVA_DASHBOARD_TOKEN!.trim();
  const qs = new URLSearchParams();
  if (scope.jiraProject?.trim()) {
    qs.set("jira", scope.jiraProject.trim().toUpperCase());
  }
  if (scope.adoOrg?.trim()) qs.set("org", scope.adoOrg.trim());
  if (scope.adoProject?.trim()) qs.set("project", scope.adoProject.trim());

  const listUrl = `${base}/kb${qs.toString() ? `?${qs}` : ""}`;
  let res: Response;
  try {
    res = await timedFetch(fetchFn, listUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    }, timeoutMs);
  } catch {
    return { ok: false, retryable: true };
  }

  if (res.status >= 500 || res.status === 0) {
    return { ok: false, retryable: true };
  }
  if (!res.ok) return { ok: false, retryable: false };

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { ok: false, retryable: true };
  }

  const entries = selectVivaEntries(normalizeVivaEntries(data), maxEntries);
  const parts: string[] = [];

  for (const entry of entries) {
    let body = entry.bodyMarkdown?.trim() ?? "";
    if (!body && entry.id) {
      body = await fetchVivaBody(base, token, entry.id, fetchFn, timeoutMs);
    }
    if (!entry.title && !body) continue;
    parts.push([`### ${entry.title || "Untitled"}`, body].filter(Boolean).join("\n"));
  }

  return { ok: true, text: truncate(parts.join("\n\n").trim(), maxChars) };
}

async function fetchVivaBody(
  base: string,
  token: string,
  id: string,
  fetchFn: typeof fetch,
  timeoutMs: number,
): Promise<string> {
  try {
    const res = await timedFetch(
      fetchFn,
      `${base}/kb/${encodeURIComponent(id)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      },
      timeoutMs,
    );
    if (!res.ok) return "";
    const data = (await res.json()) as { bodyMarkdown?: string };
    return typeof data.bodyMarkdown === "string" ? data.bodyMarkdown.trim() : "";
  } catch {
    return "";
  }
}

type VivaEntry = {
  id?: string;
  title?: string;
  kind?: string;
  bodyMarkdown?: string;
};

function normalizeVivaEntries(data: unknown): VivaEntry[] {
  if (!data || typeof data !== "object") return [];
  const obj = data as { entries?: unknown; text?: unknown };
  if (typeof obj.text === "string" && obj.text.trim()) {
    return [{ title: "Domain language", bodyMarkdown: obj.text, kind: "glossary" }];
  }
  if (!Array.isArray(obj.entries)) return [];
  return obj.entries.filter(
    (e): e is VivaEntry => e !== null && typeof e === "object",
  );
}

function sortGlossaryFirst(entries: VivaEntry[]): VivaEntry[] {
  return [...entries].sort((a, b) => {
    const aG = (a.kind ?? "note") === "glossary" ? 1 : 0;
    const bG = (b.kind ?? "note") === "glossary" ? 1 : 0;
    return bG - aG;
  });
}

/** Prefer glossary entries, then cap how many bodies we materialize. */
function selectVivaEntries(entries: VivaEntry[], maxEntries: number): VivaEntry[] {
  const limit = Math.max(0, maxEntries);
  if (!limit) return [];
  const glossaries = entries.filter((e) => (e.kind ?? "note") === "glossary");
  const preferred = glossaries.length ? glossaries : sortGlossaryFirst(entries);
  return preferred.slice(0, limit);
}

async function timedFetch(
  fetchFn: typeof fetch,
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ms = Math.max(1, timeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const parent = init.signal;
    if (parent) {
      if (parent.aborted) controller.abort();
      else {
        parent.addEventListener("abort", () => controller.abort(), { once: true });
      }
    }
    return await fetchFn(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFromConfluence(
  scope: DomainLanguageScope,
  env: NodeJS.ProcessEnv,
  fetchFn: typeof fetch,
  maxChars: number,
  timeoutMs: number,
): Promise<FetchOk | FetchMiss> {
  const base = env.AARIA_CONFLUENCE_BASE_URL!.trim().replace(/\/$/, "");
  const email = env.AARIA_CONFLUENCE_EMAIL!.trim();
  const token = env.AARIA_CONFLUENCE_TOKEN!.trim();
  const spaces = resolveSpaces(scope);
  if (!spaces.length) return { ok: false, retryable: false };

  const auth = Buffer.from(`${email}:${token}`).toString("base64");
  const headers = {
    Authorization: `Basic ${auth}`,
    Accept: "application/json",
  };

  const parts: string[] = [];
  let anyOk = false;

  for (const spaceKey of spaces) {
    try {
      const cql = [
        `space = "${spaceKey.replace(/"/g, "")}"`,
        "type = page",
        'label = "viva-kb"',
        'label = "kind-glossary"',
      ].join(" AND ");
      const qs = new URLSearchParams({
        cql,
        limit: "10",
        expand: "body.storage",
      });
      const url = `${base}/wiki/rest/api/content/search?${qs.toString()}`;
      const res = await timedFetch(fetchFn, url, { headers }, timeoutMs);
      if (!res.ok) continue;
      anyOk = true;
      const data = (await res.json()) as {
        results?: Array<{
          title?: string;
          body?: { storage?: { value?: string } };
        }>;
      };
      for (const page of data.results ?? []) {
        const body = storageHtmlToText(page.body?.storage?.value ?? "");
        if (!page.title && !body) continue;
        parts.push(
          [`### ${page.title || "Untitled"}`, body].filter(Boolean).join("\n\n"),
        );
      }
    } catch {
      // try other spaces
    }
  }

  if (!anyOk && !parts.length) return { ok: false, retryable: true };
  const text = truncate(parts.join("\n\n").trim(), maxChars);
  return { ok: true, text };
}

/** Resolve Confluence spaces: ADO org map → Jira project map → global. */
export function resolveSpaces(scope: DomainLanguageScope): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (key: string | undefined) => {
    const k = key?.trim();
    if (!k) return;
    const id = k.toUpperCase();
    if (seen.has(id)) return;
    seen.add(id);
    out.push(k);
  };

  if (scope.adoOrg?.trim()) {
    const mapped =
      DEFAULT_SPACE_MAP.adoOrgs[scope.adoOrg.trim().toLowerCase()];
    add(mapped);
    if (out.length) return out;
  }

  if (scope.jiraProject?.trim()) {
    add(
      DEFAULT_SPACE_MAP.jiraProjects[scope.jiraProject.trim().toUpperCase()],
    );
    if (out.length) return out;
  }

  add(DEFAULT_SPACE_MAP.global);
  return out;
}

/** Best-effort Confluence storage HTML → plain/markdown-ish text. */
export function storageHtmlToText(html: string): string {
  let s = html.replace(/\r\n/g, "\n");
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, inner: string) => {
    return `\n${"#".repeat(Number(level))} ${stripTags(inner).trim()}\n`;
  });
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner: string) => {
    return `\n- ${inlineToMd(inner).trim()}`;
  });
  s = s.replace(/<\/?ul[^>]*>/gi, "\n");
  s = s.replace(/<\/?ol[^>]*>/gi, "\n");
  s = s.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_m, inner: string) => {
    return `\n${inlineToMd(inner).trim()}\n`;
  });
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = stripTags(s);
  s = decodeEntities(s);
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

function inlineToMd(inner: string): string {
  let s = inner;
  s = s.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**");
  s = s.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**");
  s = s.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*");
  s = s.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "*$1*");
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
  return stripTags(s);
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}
