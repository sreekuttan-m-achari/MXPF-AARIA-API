# AARIA split config (Approach A)

**Date:** 2026-08-24  
**Status:** Approved

## Goal

Stop stuffing provider URLs, models, and TTS/MQTT knobs into `.env`. Keep **secrets and flags** in env. Put **non-secret product/provider settings** in YAML.

## Layout

```text
config/
  aaria.yaml                 # shared: timezone, cwd, learn limits (no keys)
  providers/
    cursor.yaml              # loaded only when AARIA_RUNTIME=cursor
    claude.yaml              # loaded only when AARIA_RUNTIME=claude
    mxpf.yaml                # loaded only when AARIA_RUNTIME=mxpf
    mqtt.yaml                # optional, not a brain (later)
    voice.yaml               # optional, not a brain (later)
```

`AARIA_CONFIG_DIR` overrides the directory (tests / custom install).

## Runtime gating (required)

`AARIA_RUNTIME` is the **only** brain selector and lives in `.env`.

The loader reads **at most one** brain file: `providers/<runtime>.yaml`.

- `cursor` → `cursor.yaml` only  
- `claude` / `anthropic` → `claude.yaml` only  
- `mxpf` / aliases → `mxpf.yaml` only  

Inactive brain files are **never merged**. A Cursor model in `cursor.yaml` cannot leak into an MXPF session.

## Precedence

1. Code defaults  
2. `config/aaria.yaml`  
3. Active `providers/<runtime>.yaml`  
4. Environment (wins) — keys, flags, and one-off overrides (`AARIA_MODEL`, `MXPF_HARNESS_MODEL`, …)

## Stay in `.env`

- Secrets: `CURSOR_API_KEY`, `ANTHROPIC_API_KEY`, `MXPF_HARNESS_API_KEY` / OpenRouter aliases, MQTT password, HA / VIVA / Confluence tokens  
- Flags: `AARIA_RUNTIME`, `AARIA_VOICE`, `AARIA_DEBUG`, `AARIA_MCP_ENABLED`, learn/scheduler toggles  
- Host: `AARIA_WS_PORT`, `AARIA_API_URL`

No secrets in YAML. Samples are committed; they contain URLs and model ids only.

## Out of scope (this pass)

Wiring `voice.yaml` / `mqtt.yaml` into TTS and fleet. Files may exist later; brains land first.
