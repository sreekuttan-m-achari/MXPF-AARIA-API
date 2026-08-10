# Optional VIVA KB / Confluence Adapter — Design Spec

**Date:** 2026-08-06  
**Status:** Approved  
**Repo:** `MXPF-AARIA-API`  
**Canonical design:** `VIVA-AI-Developer/docs/superpowers/specs/2026-08-06-shared-domain-language-kb-design.md` (Track A)

---

## 1. Goals

- Let this host optionally load **domain language** from VIVA KB, with Confluence fallback.
- Keep AARIA **generic and open-source**: no hard dependency on VIVA, Confluence, or Vistara.

### Non-goals

- Requiring any VIVA/Confluence env for boot or tests
- Owning KB publish/review workflow (Track A: humans publish; Learn does not write glossary)
- AI auto-draft proposers (follow-up after Track A)
- Tracks B–D (two-axis review, eng skills pack, VIVA TDD)

---

## 2. Locked decisions

| Topic | Choice |
|--------|--------|
| Coupling | Soft/optional only |
| Prefer | `GET` VIVA `/kb` when base URL + auth configured |
| Fallback | Confluence when `/kb` transport/5xx (and Confluence configured) |
| Unconfigured | No fetch, no miss noise |
| Failure | Fail soft for desk turns |
| System terms | Optional `$AARIA_HOME/CONTEXT.md` only |

---

## 3. Integration sketch

- Config/env gates (exact names in the implementation plan): VIVA base + token; Confluence base + email/token; space map optional override.
- Call only on repo-/job-aware or coding-adjacent turns (hybrid load), not every casual desk chat unless useful.
- Implementation may live as an optional module and/or skill; must not break `src/` boot when disabled.
- Existing `skills/viva-ops/` remains ops playbook — glossary fetch should not make `viva-ops` mandatory.

---

## 4. Success criteria

- Fresh clone of AARIA runs with zero VIVA/Confluence config.
- With VIVA configured, matching glossary injects when a scope is known.
- With only Confluence configured, same match works.
- Both down → soft continue.
