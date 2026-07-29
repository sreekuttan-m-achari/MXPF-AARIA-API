#!/usr/bin/env bash
# Install Piper TTS + Cori voice model for AARIA local voice replies.
# Linux / macOS: python3 venv under ~/.local/share/aaria-piper, piper → ~/.local/bin
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="${AARIA_PIPER_VENV:-$HOME/.local/share/aaria-piper}"
BIN_DIR="${HOME}/.local/bin"
MODEL_DIR="${HOME}/.local/share/piper"
MODEL_ONNX="${MODEL_DIR}/en_GB-cori-medium.onnx"
MODEL_JSON="${MODEL_DIR}/en_GB-cori-medium.onnx.json"
MODEL_URL_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_GB/cori/medium"

info() { printf '→ %s\n' "$*"; }
ok()   { printf '✓ %s\n' "$*"; }
fail() { printf '✗ %s\n' "$*" >&2; }

if ! command -v python3 >/dev/null 2>&1; then
  fail "python3 is required to install piper-tts"
  exit 1
fi

PY_VER="$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
# piper-tts wheels need a reasonably modern Python
MAJOR="${PY_VER%%.*}"
MINOR="${PY_VER#*.}"
if [[ "$MAJOR" -lt 3 ]] || { [[ "$MAJOR" -eq 3 ]] && [[ "$MINOR" -lt 9 ]]; }; then
  fail "python3 ≥ 3.9 required (found $PY_VER)"
  exit 1
fi

mkdir -p "$BIN_DIR" "$MODEL_DIR"

if [[ ! -x "${VENV}/bin/pip" ]]; then
  info "Creating Piper venv at $VENV"
  python3 -m venv "$VENV"
fi

info "Installing piper-tts into venv…"
"${VENV}/bin/pip" install -q -U pip
"${VENV}/bin/pip" install -q 'piper-tts>=1.4.0'
ln -sfn "${VENV}/bin/piper" "${BIN_DIR}/piper"
ok "piper → ${BIN_DIR}/piper"

if [[ ! -f "$MODEL_ONNX" ]]; then
  info "Downloading en_GB-cori-medium.onnx…"
  curl -fsSL -o "$MODEL_ONNX" "${MODEL_URL_BASE}/en_GB-cori-medium.onnx?download=true"
fi
if [[ ! -f "$MODEL_JSON" ]]; then
  info "Downloading en_GB-cori-medium.onnx.json…"
  curl -fsSL -o "$MODEL_JSON" "${MODEL_URL_BASE}/en_GB-cori-medium.onnx.json?download=true"
fi
ok "Voice model: $MODEL_ONNX"

# Point local .env at the Mac/Linux-correct model path when present.
ENV_FILE="${ROOT}/.env"
if [[ -f "$ENV_FILE" ]]; then
  if grep -qE '^#?[[:space:]]*AARIA_PIPER_MODEL=' "$ENV_FILE" 2>/dev/null; then
    if [[ "$(uname -s)" == "Darwin" ]]; then
      sed -i '' "s|^#*[[:space:]]*AARIA_PIPER_MODEL=.*|AARIA_PIPER_MODEL=${MODEL_ONNX}|" "$ENV_FILE"
    else
      sed -i "s|^#*[[:space:]]*AARIA_PIPER_MODEL=.*|AARIA_PIPER_MODEL=${MODEL_ONNX}|" "$ENV_FILE"
    fi
  else
    printf '\nAARIA_PIPER_MODEL=%s\n' "$MODEL_ONNX" >> "$ENV_FILE"
  fi
  # Ensure voice is on when we just installed the backend.
  if grep -qE '^#?[[:space:]]*AARIA_VOICE=' "$ENV_FILE" 2>/dev/null; then
    if [[ "$(uname -s)" == "Darwin" ]]; then
      sed -i '' 's|^#*[[:space:]]*AARIA_VOICE=.*|AARIA_VOICE=1|' "$ENV_FILE"
      sed -i '' 's|^#*[[:space:]]*AARIA_TTS=.*|AARIA_TTS=piper|' "$ENV_FILE"
    else
      sed -i 's|^#*[[:space:]]*AARIA_VOICE=.*|AARIA_VOICE=1|' "$ENV_FILE"
      sed -i 's|^#*[[:space:]]*AARIA_TTS=.*|AARIA_TTS=piper|' "$ENV_FILE"
    fi
  fi
  ok "Updated .env voice paths"
fi

export PATH="${BIN_DIR}:$PATH"
if ! command -v piper >/dev/null 2>&1; then
  fail "piper still not on PATH — add ${BIN_DIR} to PATH"
  exit 1
fi

# Smoke: synthesize a short wav (no playback required).
TMP_WAV="$(mktemp -t aaria-piper.XXXXXX.wav)"
trap 'rm -f "$TMP_WAV"' EXIT
echo 'Systems online.' | piper --model "$MODEL_ONNX" -f "$TMP_WAV" >/dev/null
ok "Piper smoke test OK ($(wc -c < "$TMP_WAV" | tr -d ' ') bytes)"

PLAYER=""
for cand in paplay pw-play aplay afplay; do
  if command -v "$cand" >/dev/null 2>&1; then
    PLAYER="$cand"
    break
  fi
done
if [[ -n "$PLAYER" ]]; then
  ok "Audio player: $PLAYER"
else
  fail "No audio player found (need paplay, pw-play, aplay, or afplay)"
  exit 1
fi

echo ""
echo "Voice install complete."
echo "  piper:  $(command -v piper)"
echo "  model:  $MODEL_ONNX"
echo "  player: $PLAYER"
echo ""
echo "Ensure ~/.local/bin is on PATH, then restart the API (LaunchAgent / systemd / npm start)."
