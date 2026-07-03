#!/usr/bin/env bash
# Install `aaria` terminal client to ~/.local/bin
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="${HOME}/.local/bin"
LINK="${BIN_DIR}/aaria"
SOURCE="${ROOT}/bin/aaria"

if [[ ! -x "$SOURCE" ]]; then
  chmod +x "$SOURCE"
fi

if [[ ! -x "${ROOT}/node_modules/.bin/tsx" ]]; then
  echo "Run npm install in $ROOT first." >&2
  exit 1
fi

mkdir -p "$BIN_DIR"
ln -sf "$SOURCE" "$LINK"

echo "Installed: $LINK"
echo ""
echo "Ensure ~/.local/bin is on your PATH, then run:"
echo "  aaria"
