#!/usr/bin/env bash
# Install `aaria` terminal client to ~/.local/bin
# Works on Linux and macOS (no GNU-only flags).
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

# Compare symlink target string (SOURCE is absolute). Avoids GNU readlink -f
# which is missing on macOS.
if [[ -L "$LINK" ]] && [[ "$(readlink "$LINK")" == "$SOURCE" ]]; then
  echo "Already linked: $LINK → $SOURCE"
else
  # Remove stale/wrong link first (may be owned by root — try, then warn).
  if [[ -L "$LINK" ]] || [[ -e "$LINK" ]]; then
    rm -f "$LINK" 2>/dev/null || {
      echo "Warning: cannot remove existing $LINK (permission denied)." >&2
      echo "Run once with sudo to fix: sudo rm -f $LINK && ln -sf $SOURCE $LINK" >&2
      exit 1
    }
  fi
  ln -sf "$SOURCE" "$LINK"
  echo "Installed: $LINK → $SOURCE"
fi

echo ""
echo "Ensure ~/.local/bin is on your PATH, then run:"
echo "  aaria"
