# Pluggable AI brain providers — cross-project future plan

**Date:** 2026-07-20  
**Status:** Future — **not in v1** for any consuming project  
**Applies to:** **AARIA** (this repo) · [VIVA](../../WORKS/VISTARA-HUB/AI-Systems/VIVA-AI-Developer) · [Code-Reviewer](../../WORKS/VISTARA-HUB/AI-Systems/Code-Reviewer)

> Canonical copy also lives in **VIVA** and **Code-Reviewer** repos at `docs/superpowers/specs/2026-07-20-pluggable-ai-brain-future.md`.

---

## 1. Context

Today all three products standardize on **Cursor SDK (`@cursor/sdk`)** as the LLM/runtime brain:

| Product | v1 brain | Notes |
|---------|----------|-------|
| **AARIA** | Cursor SDK | Desk assistant; `AARIA_MODEL` selects within Cursor |
| **VIVA** | Cursor SDK | Autonomous engineer; local agent on VM workspace |
| **Code-Reviewer** | Cursor SDK (Phase 3) | PR reviewer on CI agent / local clone |

This is the right v1 default: one runtime, MCP tooling, session resume, and patterns already proven in AARIA.

**Later**, teams may need:

- Model/provider choice per deployment (Claude, GPT, Grok, open weights via OpenRouter, etc.)
- Cost/latency tuning (cheap model for triage, strong model for coding/review)
- Org policy (keys stay in Azure Key Vault / ADO variable groups, not Cursor-only)
- Fallback when Cursor platform is unavailable

---

## 2. Goal (future)

Introduce a **pluggable brain adapter** — a small interface each product implements once, with provider-specific backends added incrementally.

```text
BrainAdapter (interface)
  ├── cursor      ← v1 default (existing @cursor/sdk path)
  ├── openrouter  ← OpenAI-compatible API gateway
  ├── anthropic   ← Claude API direct
  ├── openai      ← OpenAI API direct
  ├── xai         ← Grok / xAI
  └── …           ← extensible
```

Each adapter must support the product’s minimum contract:

| Capability | AARIA / VIVA | Code-Reviewer |
|------------|--------------|---------------|
| Streaming text | Required | Required |
| Tool/MCP execution | Required (VIVA, AARIA) | Optional later |
| Structured JSON output | Optional | **Required** (`ReviewResult` schema) |
| Session resume / multi-turn | Required | Single-turn v1; resume optional |
| Local `{ cwd }` workspace | VIVA, Code-Reviewer | Required |

---

## 3. Configuration sketch (future)

Not implemented — illustrative only:

```yaml
# Example: .env + optional home config (VIVA / Code-Reviewer)
brain:
  provider: cursor          # cursor | openrouter | anthropic | openai | xai
  model: composer-2.5       # provider-specific model id
  fallback: openrouter      # optional secondary provider
```

Env / secrets (never in git):

| Provider | Typical secret env |
|----------|-------------------|
| Cursor | `CURSOR_API_KEY` |
| OpenRouter | `OPENROUTER_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| xAI | `XAI_API_KEY` |

Per-product env prefix examples: `AARIA_BRAIN_PROVIDER`, `VIVA_BRAIN_PROVIDER`, `CODE_REVIEWER_BRAIN_PROVIDER`.

---

## 4. Shared design principles

1. **Cursor remains default** until an alternate adapter passes the same integration tests (streaming, cancel, error surfaces).
2. **MCP is optional per provider** — non-Cursor backends may use tool-call shims or a thin “tool runner” layer; document limitations.
3. **Structured output** — Code-Reviewer needs fenced JSON parsing; chat products need plain text. Adapters expose both modes.
4. **Secrets** — provider keys only via env / variable groups; never in YAML, markdown packs, or repo config.
5. **Audit** — log `provider`, `model`, token usage (when available), and `runId`; never log raw keys.
6. **Incremental rollout** — ship one non-Cursor adapter (likely **OpenRouter** first — widest model surface, OpenAI-compatible API) before direct vendor SDKs.

---

## 5. Per-product notes

### AARIA

- v1: Cursor-only (`AARIA_MODEL`, learn loop uses `AARIA_LEARN_MODEL`).
- Future: brain adapter in `src/agent.ts` / `agent-manager.ts`; TUI `/cursor` ops panel becomes `/brain`.
- ASTRA minion optional local brain (`ASTRA_BRAIN=1`) should reuse the same adapter interface when implemented.

### VIVA

- v1: Cursor-only for coding sessions (`CURSOR_API_KEY` on host).
- Future: per-host `brain.provider` in `$VIVA_HOME/config.yaml`; dry-run must work without any provider key.
- Rework turns that consume Code-Reviewer threads do not change — brain swap is internal to the coding agent.

### Code-Reviewer

- v1 (Phase 3): Cursor-only on CI agent + local runs.
- Future: `CODE_REVIEWER_BRAIN` for orgs that cannot use Cursor in pipeline; structured `ReviewResult` JSON is the portability contract.
- CI agents without Cursor may prefer OpenRouter/Anthropic with **no MCP** (diff + standards in prompt only).

---

## 6. Suggested implementation order (when prioritized)

1. Extract shared `BrainAdapter` types into a small internal package or copied module (keep DRY across repos).
2. **OpenRouter** adapter — single HTTP client, many models.
3. **Anthropic** adapter — strong for review + coding.
4. **OpenAI** / **xAI** as demand dictates.
5. Cross-product docs + migration guide from Cursor-only configs.

---

## 7. Non-goals (this future track)

- Running multiple providers in one turn (ensemble / voting)
- User-facing model marketplace UI
- Replacing Cursor IDE integration — this is about **headless/agent** runtimes only
- v1 scope for any of the three products

---

## 8. References

- ASTRA optional minion brain: `docs/superpowers/specs/2026-07-18-astra-design.md` (`ASTRA_BRAIN=1`)
- VIVA design: `VIVA-AI-Developer/docs/superpowers/specs/2026-07-20-viva-ai-developer-design.md`
- Code-Reviewer design: `Code-Reviewer/docs/superpowers/specs/2026-07-19-code-reviewer-cli-design.md`
