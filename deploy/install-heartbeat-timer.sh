#!/usr/bin/env bash
# Optional: install aria-heartbeat.timer — external curl watchdog (in addition to in-process scheduler).
set -euo pipefail

SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USER_UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SERVICE_TEMPLATE="${SERVER_DIR}/deploy/aria-heartbeat.service.in"
TIMER_TEMPLATE="${SERVER_DIR}/deploy/aria-heartbeat.timer.in"

mkdir -p "$USER_UNIT_DIR"

API_URL="${AARIA_API_URL:-http://127.0.0.1:8788}"
sed \
  -e "s|__AARIA_API_URL__|${API_URL}|g" \
  "$SERVICE_TEMPLATE" > "${USER_UNIT_DIR}/aria-heartbeat.service"

cp "$TIMER_TEMPLATE" "${USER_UNIT_DIR}/aria-heartbeat.timer"

systemctl --user daemon-reload
systemctl --user enable aria-heartbeat.timer
systemctl --user start aria-heartbeat.timer

echo "Installed aria-heartbeat.timer (POST ${API_URL}/jobs/run id=heartbeat every 5m)"
echo ""
echo "  systemctl --user status aria-heartbeat.timer"
echo "  systemctl --user list-timers aria-heartbeat.timer"
