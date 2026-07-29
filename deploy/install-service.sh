#!/usr/bin/env bash
# Install aria-api as a background service:
#   Linux  → systemd user unit (aria-api.service)
#   macOS  → LaunchAgent (com.aaria.api)
set -euo pipefail

SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OS="$(uname -s)"

require_common() {
  if [[ ! -f "$SERVER_DIR/.env" ]]; then
    echo "Missing $SERVER_DIR/.env — copy .env-sample and set CURSOR_API_KEY first." >&2
    exit 1
  fi

  TSX="${SERVER_DIR}/node_modules/.bin/tsx"
  if [[ ! -x "$TSX" ]]; then
    echo "Run npm install in $SERVER_DIR first." >&2
    exit 1
  fi

  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    # shellcheck source=/dev/null
    . "$NVM_DIR/nvm.sh"
    if [[ -f "$SERVER_DIR/.nvmrc" ]]; then
      cd "$SERVER_DIR"
      nvm install >/dev/null 2>&1 || true
      nvm use >/dev/null 2>&1 || true
    fi
  fi

  NODE="$(command -v node || true)"
  if [[ -z "$NODE" ]]; then
    echo "node not found. Install Node ≥ 22.13 (nvm or Homebrew)." >&2
    exit 1
  fi

  NODE_VERSION="$("$NODE" -v)"
  NODE_MAJOR="${NODE_VERSION#v}"
  NODE_MAJOR="${NODE_MAJOR%%.*}"
  if [[ "$NODE_MAJOR" -lt 22 ]]; then
    echo "Expected Node ≥ 22.13, got $NODE_VERSION at $NODE" >&2
    exit 1
  fi
}

install_systemd() {
  local USER_UNIT_DIR SERVICE_NAME TEMPLATE USER_NAME
  USER_UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
  SERVICE_NAME="aria-api.service"
  TEMPLATE="${SERVER_DIR}/deploy/aria-api.service.in"

  # Keep Linux pin to Node 22.x for nvm/.nvmrc parity with existing hosts.
  if [[ "$NODE_VERSION" != v22* ]]; then
    echo "Expected Node 22.x on Linux (see .nvmrc), got $NODE_VERSION at $NODE" >&2
    echo "Run: cd $SERVER_DIR && nvm install && nvm use" >&2
    exit 1
  fi

  USER_NAME="$(whoami)"
  mkdir -p "$USER_UNIT_DIR"

  sed \
    -e "s|__SERVICE_USER__|${USER_NAME}|g" \
    -e "s|__SERVER_DIR__|${SERVER_DIR}|g" \
    -e "s|__NODE__|${NODE}|g" \
    -e "s|__TSX__|${TSX}|g" \
    "$TEMPLATE" > "${USER_UNIT_DIR}/${SERVICE_NAME}"

  systemctl --user daemon-reload
  systemctl --user enable "${SERVICE_NAME}"
  systemctl --user reset-failed "${SERVICE_NAME}" 2>/dev/null || true
  systemctl --user restart "${SERVICE_NAME}"

  echo "Installed ${SERVICE_NAME} using ${NODE} (${NODE_VERSION})"
  echo ""
  echo "  systemctl --user status ${SERVICE_NAME}"
  echo "  journalctl --user -u ${SERVICE_NAME} -f"
  echo ""
  echo "Stop any manual 'npm start' on port 8788 before using the service."
  echo "To keep running after logout (optional):"
  echo "  loginctl enable-linger ${USER_NAME}"
}

install_launchd() {
  local LABEL PLIST_DIR PLIST TEMPLATE WRAPPER LOG_DIR NODE_DIR LAUNCH_PATH UID_NUM DOMAIN
  LABEL="${AARIA_LAUNCHD_LABEL:-com.aaria.api}"
  PLIST_DIR="${HOME}/Library/LaunchAgents"
  PLIST="${PLIST_DIR}/${LABEL}.plist"
  TEMPLATE="${SERVER_DIR}/deploy/com.aaria.api.plist.in"
  WRAPPER="${SERVER_DIR}/deploy/aaria-api-launch.sh"
  LOG_DIR="${HOME}/Library/Logs/aaria"
  UID_NUM="$(id -u)"
  DOMAIN="gui/${UID_NUM}"

  if [[ ! -f "$TEMPLATE" ]]; then
    echo "Missing template: $TEMPLATE" >&2
    exit 1
  fi
  if [[ ! -f "$WRAPPER" ]]; then
    echo "Missing launch wrapper: $WRAPPER" >&2
    exit 1
  fi
  chmod +x "$WRAPPER"

  mkdir -p "$PLIST_DIR" "$LOG_DIR"

  NODE_DIR="$(dirname "$NODE")"
  # Prefer a PATH that includes the resolved node (Homebrew / nvm) plus commons.
  LAUNCH_PATH="${NODE_DIR}:${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

  sed \
    -e "s|__LABEL__|${LABEL}|g" \
    -e "s|__WRAPPER__|${WRAPPER}|g" \
    -e "s|__SERVER_DIR__|${SERVER_DIR}|g" \
    -e "s|__LOG_DIR__|${LOG_DIR}|g" \
    -e "s|__HOME__|${HOME}|g" \
    -e "s|__PATH__|${LAUNCH_PATH}|g" \
    "$TEMPLATE" > "$PLIST"

  # Modern launchctl (macOS 10.13+): bootout → bootstrap → kickstart
  launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null || true
  launchctl bootstrap "$DOMAIN" "$PLIST"
  launchctl enable "${DOMAIN}/${LABEL}" 2>/dev/null || true
  launchctl kickstart -k "${DOMAIN}/${LABEL}"

  echo "Installed LaunchAgent ${LABEL} using ${NODE} (${NODE_VERSION})"
  echo ""
  echo "  launchctl print ${DOMAIN}/${LABEL}"
  echo "  tail -f ${LOG_DIR}/aria-api.err.log"
  echo "  curl -s http://127.0.0.1:8788/health"
  echo ""
  echo "Stop / unload:"
  echo "  launchctl bootout ${DOMAIN}/${LABEL}"
  echo ""
  echo "Stop any manual 'npm start' on port 8788 before using the LaunchAgent."
}

require_common

case "$OS" in
  Darwin*)
    install_launchd
    ;;
  Linux*)
    install_systemd
    ;;
  *)
    echo "Unsupported OS: $OS — use npm start for the API." >&2
    exit 1
    ;;
esac
