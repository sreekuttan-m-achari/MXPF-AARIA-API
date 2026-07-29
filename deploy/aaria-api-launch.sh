#!/usr/bin/env bash
# LaunchAgent entrypoint for com.aaria.api — loads .env then runs the API.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
fi

TSX="$ROOT/node_modules/.bin/tsx"
if [[ ! -x "$TSX" ]]; then
  echo "tsx missing — run npm install in $ROOT" >&2
  exit 1
fi

NODE="$(command -v node || true)"
if [[ -z "$NODE" ]]; then
  echo "node not found on PATH (LaunchAgent PATH may be too narrow)" >&2
  exit 1
fi

exec "$NODE" "$TSX" "$ROOT/src/main.ts"
