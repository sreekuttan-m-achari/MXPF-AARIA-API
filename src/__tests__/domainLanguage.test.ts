import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  isCodingAdjacentTurn,
  loadDomainLanguage,
  type DomainLanguageResult,
} from "../kb/domainLanguage.js";

const KB_ENV = [
  "AARIA_VIVA_KB_BASE_URL",
  "AARIA_VIVA_DASHBOARD_TOKEN",
  "AARIA_CONFLUENCE_BASE_URL",
  "AARIA_CONFLUENCE_EMAIL",
  "AARIA_CONFLUENCE_TOKEN",
] as const;

const saved: Partial<Record<(typeof KB_ENV)[number], string | undefined>> = {};

function clearKbEnv(): void {
  for (const key of KB_ENV) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
}

function restoreKbEnv(): void {
  for (const key of KB_ENV) {
    const v = saved[key];
    if (v === undefined) delete process.env[key];
    else process.env[key] = v;
  }
}

afterEach(() => {
  restoreKbEnv();
});

describe("loadDomainLanguage", () => {
  it("returns none and does not fetch when unconfigured", async () => {
    clearKbEnv();
    let fetches = 0;
    const fetchFn: typeof fetch = async () => {
      fetches += 1;
      throw new Error("fetch should not be called");
    };

    const result = await loadDomainLanguage({}, { fetchFn });
    assert.deepEqual(result, { text: "", source: "none" } satisfies DomainLanguageResult);
    assert.equal(fetches, 0);
  });

  it("uses VIVA when GET /kb returns 200", async () => {
    clearKbEnv();
    process.env.AARIA_VIVA_KB_BASE_URL = "https://viva.example";
    process.env.AARIA_VIVA_DASHBOARD_TOKEN = "dash-tok";

    const fetchFn: typeof fetch = async (input, init) => {
      const url = String(input);
      assert.match(url, /^https:\/\/viva\.example\/kb/);
      assert.equal(
        (init?.headers as Record<string, string> | undefined)?.Authorization,
        "Bearer dash-tok",
      );
      return new Response(
        JSON.stringify({
          entries: [
            {
              id: "g1",
              title: "Payments",
              kind: "glossary",
              bodyMarkdown: "**Settlement**: final transfer",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const result = await loadDomainLanguage(
      { jiraProject: "D9", adoOrg: "digit9" },
      { fetchFn },
    );
    assert.equal(result.source, "viva");
    assert.match(result.text, /Settlement/);
    assert.match(result.text, /Payments/);
  });

  it("falls back to Confluence when VIVA returns 5xx", async () => {
    clearKbEnv();
    process.env.AARIA_VIVA_KB_BASE_URL = "https://viva.example";
    process.env.AARIA_VIVA_DASHBOARD_TOKEN = "dash-tok";
    process.env.AARIA_CONFLUENCE_BASE_URL =
      "https://viva-knowledgebase.atlassian.net";
    process.env.AARIA_CONFLUENCE_EMAIL = "ops@test";
    process.env.AARIA_CONFLUENCE_TOKEN = "cf-tok";

    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("viva.example")) {
        return new Response("boom", { status: 503 });
      }
      assert.match(url, /wiki\/rest\/api\/content\/search/);
      assert.match(decodeURIComponent(url), /kind-glossary/);
      return new Response(
        JSON.stringify({
          results: [
            {
              id: "99",
              title: "Digit9 glossary",
              body: {
                storage: {
                  value: "<p><strong>Merchant</strong>: payer entity</p>",
                },
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const result = await loadDomainLanguage(
      { adoOrg: "digit9", adoProject: "CBaaS-Backend" },
      { fetchFn },
    );
    assert.equal(result.source, "confluence");
    assert.match(result.text, /Merchant/);
    assert.match(result.text, /Digit9 glossary/);
  });

  it("uses Confluence alone when VIVA is unset", async () => {
    clearKbEnv();
    process.env.AARIA_CONFLUENCE_BASE_URL =
      "https://viva-knowledgebase.atlassian.net";
    process.env.AARIA_CONFLUENCE_EMAIL = "ops@test";
    process.env.AARIA_CONFLUENCE_TOKEN = "cf-tok";

    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      assert.equal(url.includes("viva.example"), false);
      assert.match(url, /content\/search/);
      return new Response(
        JSON.stringify({
          results: [
            {
              id: "1",
              title: "Terms",
              body: { storage: { value: "<p>Wallet balance</p>" } },
            },
          ],
        }),
        { status: 200 },
      );
    };

    const result = await loadDomainLanguage({ jiraProject: "D9" }, { fetchFn });
    assert.equal(result.source, "confluence");
    assert.match(result.text, /Wallet balance/);
  });

  it("returns none without throwing when both fail", async () => {
    clearKbEnv();
    process.env.AARIA_VIVA_KB_BASE_URL = "https://viva.example";
    process.env.AARIA_VIVA_DASHBOARD_TOKEN = "dash-tok";
    process.env.AARIA_CONFLUENCE_BASE_URL =
      "https://viva-knowledgebase.atlassian.net";
    process.env.AARIA_CONFLUENCE_EMAIL = "ops@test";
    process.env.AARIA_CONFLUENCE_TOKEN = "cf-tok";

    const fetchFn: typeof fetch = async () => {
      throw new Error("network down");
    };

    const result = await loadDomainLanguage({ adoOrg: "digit9" }, { fetchFn });
    assert.deepEqual(result, { text: "", source: "none" });
  });

  it("caps meta-only body fetches and prefers glossary", async () => {
    clearKbEnv();
    process.env.AARIA_VIVA_KB_BASE_URL = "https://viva.example";
    process.env.AARIA_VIVA_DASHBOARD_TOKEN = "dash-tok";

    const urls: string[] = [];
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      urls.push(url);
      if (url === "https://viva.example/kb") {
        return new Response(
          JSON.stringify({
            entries: [
              { id: "n1", title: "Note 1", kind: "note" },
              { id: "g1", title: "Glossary 1", kind: "glossary" },
              { id: "g2", title: "Glossary 2", kind: "glossary" },
              { id: "g3", title: "Glossary 3", kind: "glossary" },
              { id: "n2", title: "Note 2", kind: "note" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      const id = url.split("/").pop();
      return new Response(
        JSON.stringify({ bodyMarkdown: `body-${id}` }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const result = await loadDomainLanguage(
      {},
      { fetchFn, maxEntries: 2 },
    );
    assert.equal(result.source, "viva");
    assert.match(result.text, /Glossary 1/);
    assert.match(result.text, /Glossary 2/);
    assert.equal(result.text.includes("Glossary 3"), false);
    assert.equal(result.text.includes("Note 1"), false);
    const bodyFetches = urls.filter((u) => /\/kb\/g\d$/.test(u));
    assert.equal(bodyFetches.length, 2);
    assert.equal(urls.some((u) => u.endsWith("/kb/n1") || u.endsWith("/kb/n2")), false);
  });

  it("treats timed-out VIVA fetch as soft miss", async () => {
    clearKbEnv();
    process.env.AARIA_VIVA_KB_BASE_URL = "https://viva.example";
    process.env.AARIA_VIVA_DASHBOARD_TOKEN = "dash-tok";

    const fetchFn: typeof fetch = async (_input, init) => {
      await new Promise<never>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error("missing abort signal"));
          return;
        }
        if (signal.aborted) {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          return;
        }
        signal.addEventListener(
          "abort",
          () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          { once: true },
        );
      });
      throw new Error("unreachable");
    };

    const result = await loadDomainLanguage({}, { fetchFn, timeoutMs: 20 });
    assert.deepEqual(result, { text: "", source: "none" });
  });
});

describe("isCodingAdjacentTurn", () => {
  it("detects coding/repo-aware messages", () => {
    assert.equal(isCodingAdjacentTurn("please review this PR"), true);
    assert.equal(isCodingAdjacentTurn("refactor the payment service"), true);
    assert.equal(isCodingAdjacentTurn("what time is lunch?"), false);
  });
});
