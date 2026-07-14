#!/usr/bin/env bash
# Guided interactive install / upgrade / reinstall for AARIA (API + aaria TUI).
#
# Usage:
#   bash deploy/install-upgrade.sh              # install or upgrade (prompts)
#   bash deploy/install-upgrade.sh --reinstall  # wipe deps & redeploy; keep local config
#   bash deploy/install-upgrade.sh --help
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ── Args ──────────────────────────────────────────────────────────────────────

FORCE_REINSTALL=0
for arg in "$@"; do
  case "$arg" in
    --reinstall|-r) FORCE_REINSTALL=1 ;;
    --help|-h)
      cat <<'EOF'
AARIA guided install / upgrade / reinstall

  bash deploy/install-upgrade.sh              Detect install vs upgrade
  bash deploy/install-upgrade.sh --reinstall  Clean redeploy (keeps local config)
  bash deploy/install-upgrade.sh -r           Same as --reinstall

Reinstall (Option A) removes node_modules (+ dist) and reinstalls deps, CLI,
and the systemd service if already present. It never modifies:

  .env  SOUL.md  USER.md  MEMORY.md  .cursor/mcp.json
  .aria-conversations.ndjson  .aria-learn-pending.json
EOF
      exit 0
      ;;
    *)
      printf 'Unknown option: %s (try --help)\n' "$arg" >&2
      exit 2
      ;;
  esac
done

# ── UI helpers ────────────────────────────────────────────────────────────────

if [[ -t 1 ]]; then
  BOLD=$'\033[1m'
  DIM=$'\033[2m'
  GREEN=$'\033[32m'
  YELLOW=$'\033[33m'
  RED=$'\033[31m'
  CYAN=$'\033[36m'
  RESET=$'\033[0m'
else
  BOLD="" DIM="" GREEN="" YELLOW="" RED="" CYAN="" RESET=""
fi

info()  { printf '%s\n' "${CYAN}→${RESET} $*"; }
ok()    { printf '%s\n' "${GREEN}✓${RESET} $*"; }
warn()  { printf '%s\n' "${YELLOW}!${RESET} $*"; }
fail()  { printf '%s\n' "${RED}✗${RESET} $*" >&2; }
step()  { printf '\n%s%s%s\n' "${BOLD}" "$*" "${RESET}"; }
hr()    { printf '%s\n' "${DIM}────────────────────────────────────────────────${RESET}"; }

# Portable lowercase (Bash 3.2 on macOS lacks ${var,,}).
to_lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# GNU sed: sed -i; BSD/macOS sed: sed -i ''.
sed_inplace() {
  local expr="$1" file="$2"
  if [[ "$(uname -s)" == "Darwin" ]]; then
    sed -i '' "$expr" "$file"
  else
    sed -i "$expr" "$file"
  fi
}

# OS family for service / port probes.
OS_FAMILY=linux
case "$(uname -s)" in
  Darwin*) OS_FAMILY=macos ;;
  Linux*)  OS_FAMILY=linux ;;
  *)       OS_FAMILY=other ;;
esac

prompt_yn() {
  local question="$1"
  local default="${2:-y}"
  local hint reply
  if [[ "$default" == "y" ]]; then hint="Y/n"; else hint="y/N"; fi
  while true; do
    printf '%s [%s] ' "$question" "$hint" >/dev/tty
    read -r reply </dev/tty || reply=""
    reply="${reply:-$default}"
    case "$(to_lower "$reply")" in
      y|yes) return 0 ;;
      n|no)  return 1 ;;
      *) warn "Please answer y or n." ;;
    esac
  done
}

prompt_value() {
  local question="$1"
  local default="${2:-}"
  local secret="${3:-0}"
  local reply
  if [[ -n "$default" ]]; then
    printf '%s [%s]: ' "$question" "$default" >/dev/tty
  else
    printf '%s: ' "$question" >/dev/tty
  fi
  if [[ "$secret" == "1" ]]; then
    read -rs reply </dev/tty || reply=""
    printf '\n' >/dev/tty
  else
    read -r reply </dev/tty || reply=""
  fi
  if [[ -z "$reply" ]]; then
    printf '%s' "$default"
  else
    printf '%s' "$reply"
  fi
}

pause() {
  printf '\nPress Enter to continue… ' >/dev/tty
  read -r _ </dev/tty || true
}

# Local config that reinstall must never touch.
PRESERVE_FILES=(
  .env
  SOUL.md
  USER.md
  MEMORY.md
  .cursor/mcp.json
  .aria-conversations.ndjson
  .aria-learn-pending.json
)
PRESERVE_CHECKSUMS=()

# ── Detection ─────────────────────────────────────────────────────────────────

MODE="install"
if [[ -f "$ROOT/.env" ]] || [[ -d "$ROOT/node_modules" ]] || [[ -L "$HOME/.local/bin/aaria" ]]; then
  MODE="upgrade"
fi
if [[ "$FORCE_REINSTALL" -eq 1 ]]; then
  MODE="reinstall"
fi

PREREQ_ISSUES=0
PREREQ_WARNINGS=0
SELF_CHECK_FAILURES=0

# ── Prerequisites ─────────────────────────────────────────────────────────────

check_command() {
  local cmd="$1" label="${2:-$1}"
  if command -v "$cmd" >/dev/null 2>&1; then
    ok "$label found ($(command -v "$cmd"))"
    return 0
  fi
  fail "$label not found"
  PREREQ_ISSUES=$((PREREQ_ISSUES + 1))
  return 1
}

check_node_version() {
  local node_bin="${1:-node}"
  if ! command -v "$node_bin" >/dev/null 2>&1; then
    fail "node not found"
    PREREQ_ISSUES=$((PREREQ_ISSUES + 1))
    return 1
  fi
  local ver
  ver="$("$node_bin" -v 2>/dev/null || true)"
  local major minor patch
  major="${ver#v}"; major="${major%%.*}"
  minor="${ver#v}"; minor="${minor#*.}"; minor="${minor%%.*}"
  patch="${ver#v}"; patch="${patch#*.*.}"; patch="${patch%%[-+]*}"
  if [[ "$major" -lt 22 ]] || { [[ "$major" -eq 22 ]] && [[ "$minor" -lt 13 ]]; }; then
    fail "Node $ver — need ≥ 22.13 (see .nvmrc)"
    PREREQ_ISSUES=$((PREREQ_ISSUES + 1))
    return 1
  fi
  ok "Node $ver ($node_bin)"
  return 0
}

check_user_systemd() {
  if [[ "$OS_FAMILY" == "macos" ]]; then
    warn "macOS detected — systemd user services are Linux-only"
    warn "  After install, run the API with: npm start"
    warn "  (launchd plist install is not provided yet)"
    PREREQ_WARNINGS=$((PREREQ_WARNINGS + 1))
    return 1
  fi
  if systemctl --user show-environment >/dev/null 2>&1; then
    ok "systemd user session available"
    return 0
  fi
  warn "systemd user session not available (common over SSH without desktop login)"
  warn "  Service install will still proceed; start API manually with: npm start"
  warn "  Or enable linger: sudo loginctl enable-linger $(whoami)"
  PREREQ_WARNINGS=$((PREREQ_WARNINGS + 1))
  return 1
}

check_port_8788() {
  if command -v ss >/dev/null 2>&1; then
    if ss -tlnH sport = :8788 2>/dev/null | grep -q .; then
      warn "Port 8788 is already in use"
      ss -tlnpH sport = :8788 2>/dev/null || true
      PREREQ_WARNINGS=$((PREREQ_WARNINGS + 1))
      return 1
    fi
  elif command -v lsof >/dev/null 2>&1; then
    # macOS/BSD-friendly probe (no -sTCP:LISTEN required)
    if lsof -nP -iTCP:8788 -sTCP:LISTEN >/dev/null 2>&1 || \
       lsof -nP -iTCP:8788 2>/dev/null | grep -qi LISTEN; then
      warn "Port 8788 is already in use"
      PREREQ_WARNINGS=$((PREREQ_WARNINGS + 1))
      return 1
    fi
  fi
  ok "Port 8788 appears free"
  return 0
}

check_path_local_bin() {
  if [[ ":$PATH:" == *":$HOME/.local/bin:"* ]]; then
    ok "~/.local/bin is on PATH"
    return 0
  fi
  warn "~/.local/bin is not on PATH — aaria may not be found in new shells (SSH, etc.)"
  PREREQ_WARNINGS=$((PREREQ_WARNINGS + 1))
  return 1
}

run_prerequisite_checks() {
  step "Step 1 · Prerequisites"
  hr
  # || true so set -e does not abort before we can report all issues.
  check_command git || true
  check_command curl || true
  check_command npm || true
  check_command sed || true
  check_user_systemd || true
  check_port_8788 || true
  check_path_local_bin || true

  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    # shellcheck source=/dev/null
    . "$NVM_DIR/nvm.sh"
    ok "nvm found ($NVM_DIR)"
  else
    warn "nvm not found — install Node 22.13+ manually or via https://github.com/nvm-sh/nvm"
    PREREQ_WARNINGS=$((PREREQ_WARNINGS + 1))
  fi

  # Run in the current shell (already cd'd to ROOT) so PATH from nvm use sticks.
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    nvm install >/dev/null 2>&1 || true
    nvm use >/dev/null 2>&1 || true
  fi
  check_node_version "$(command -v node || echo node)" || true

  if [[ "$PREREQ_ISSUES" -gt 0 ]]; then
    fail "$PREREQ_ISSUES blocking issue(s). Fix them and re-run."
    exit 1
  fi
  if [[ "$PREREQ_WARNINGS" -gt 0 ]]; then
    warn "$PREREQ_WARNINGS warning(s) — review above before continuing."
  else
    ok "All prerequisite checks passed"
  fi
}

# ── Node / npm ─────────────────────────────────────────────────────────────────

setup_node_and_deps() {
  step "Step 2 · Node.js & dependencies"
  hr

  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    # shellcheck source=/dev/null
    . "$NVM_DIR/nvm.sh"
    info "Installing Node from .nvmrc…"
    # Must not use a subshell — nvm use only updates PATH in the current shell.
    nvm install
    nvm use
    ok "Node $(node -v) active"
  fi

  info "Running npm install…"
  npm install
  ok "npm dependencies installed"

  if [[ ! -x "$ROOT/node_modules/.bin/tsx" ]]; then
    fail "tsx missing after npm install"
    exit 1
  fi
  ok "tsx ready"
}

# ── .env management ───────────────────────────────────────────────────────────

env_get() {
  local key="$1" file="${2:-$ROOT/.env}"
  [[ -f "$file" ]] || return 1
  grep -E "^${key}=" "$file" 2>/dev/null | tail -1 | cut -d= -f2- | sed 's/^["'\''"]//;s/["'\''"]$//' || true
}

# env_get exits 0 with an empty string when the key is missing — so
# `$(env_get KEY || echo default)` never uses the default. Use this instead.
env_get_or() {
  local key="$1" default="$2" value
  value="$(env_get "$key" || true)"
  if [[ -n "$value" ]]; then
    printf '%s' "$value"
  else
    printf '%s' "$default"
  fi
}

env_set() {
  local key="$1" value="$2" file="${3:-$ROOT/.env}"
  if grep -qE "^${key}=" "$file" 2>/dev/null; then
    sed_inplace "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$file"
  fi
}

is_placeholder_key() {
  local v="$1"
  [[ -z "$v" ]] && return 0
  [[ "$v" == "cursor_api_key_here" ]] && return 0
  [[ "$v" == *"your_"* ]] && return 0
  return 1
}

configure_env() {
  step "Step 3 · Configuration (.env)"
  hr

  if [[ ! -f "$ROOT/.env" ]]; then
    cp "$ROOT/.env-sample" "$ROOT/.env"
    ok "Created .env from .env-sample"
  else
    ok ".env already exists"
    if [[ "$MODE" == "upgrade" ]] && ! prompt_yn "Review / update .env settings?" "n"; then
      info "Keeping existing .env"
      return 0
    fi
  fi

  local existing_key current_key
  existing_key="$(env_get CURSOR_API_KEY || true)"
  if is_placeholder_key "$existing_key"; then
    warn "CURSOR_API_KEY is missing or still a placeholder"
    current_key="$(prompt_value "Enter your CURSOR_API_KEY" "" 1)"
    while is_placeholder_key "$current_key"; do
      fail "A valid CURSOR_API_KEY is required"
      current_key="$(prompt_value "Enter your CURSOR_API_KEY" "" 1)"
    done
    env_set CURSOR_API_KEY "$current_key"
    ok "CURSOR_API_KEY saved"
  else
    ok "CURSOR_API_KEY already set (${existing_key:0:8}…)"
    if prompt_yn "Replace CURSOR_API_KEY?" "n"; then
      current_key="$(prompt_value "Enter new CURSOR_API_KEY" "" 1)"
      env_set CURSOR_API_KEY "$current_key"
      ok "CURSOR_API_KEY updated"
    fi
  fi

  if prompt_yn "Configure optional API URL / port?" "n"; then
    local host port url
    host="$(prompt_value "AARIA_WS_HOST" "$(env_get_or AARIA_WS_HOST 127.0.0.1)")"
    port="$(prompt_value "AARIA_WS_PORT" "$(env_get_or AARIA_WS_PORT 8788)")"
    url="$(prompt_value "AARIA_API_URL" "http://${host}:${port}")"
    env_set AARIA_WS_HOST "$host"
    env_set AARIA_WS_PORT "$port"
    env_set AARIA_API_URL "$url"
    ok "Network settings saved"
  fi

  if prompt_yn "Enable learn loop (post-turn MEMORY.md review)?" "y"; then
    env_set AARIA_LEARN_REVIEW "1"
  else
    env_set AARIA_LEARN_REVIEW "0"
  fi

  if prompt_yn "Require approval before writing learned facts?" "n"; then
    env_set AARIA_LEARN_APPROVAL "1"
  else
    env_set AARIA_LEARN_APPROVAL "0"
  fi

  ok ".env configuration complete"
}

# ── Persona files ─────────────────────────────────────────────────────────────

copy_if_missing() {
  local sample="$1" target="$2" label="$3"
  if [[ -f "$target" ]]; then
    ok "$label already exists ($target)"
    return 1
  fi
  cp "$sample" "$target"
  ok "Created $label from sample"
  return 0
}

configure_user_profile() {
  local call_name timezone
  call_name="$(prompt_value "What should AARIA call you? (USER.md **Call me:**)" "Sree")"
  timezone="$(prompt_value "Your timezone (USER.md **Timezone:**)" "Asia/Kolkata")"

  if [[ -f "$ROOT/USER.md" ]]; then
    sed_inplace "s|^\*\*Call me:\*\*.*|**Call me:** ${call_name}|" "$ROOT/USER.md"
    sed_inplace "s|^\*\*Timezone:\*\*.*|**Timezone:** ${timezone}|" "$ROOT/USER.md"
  else
    cat > "$ROOT/USER.md" <<EOF
**Call me:** ${call_name}
**Timezone:** ${timezone}

## Context

- **ARIA** — work desk assistant (DevOps, coding, servers, planning)
- **Amelia** — home/personal assistant (port 8787)

## Preferences

- Concise replies; expand when asked
- Flag prod/destructive ops before executing
EOF
  fi
  ok "USER.md configured (Call me: ${call_name}, Timezone: ${timezone})"
}

configure_persona() {
  step "Step 4 · Persona & memory (SOUL · USER · MEMORY)"
  hr

  if copy_if_missing "$ROOT/SOUL.sample.md" "$ROOT/SOUL.md" "SOUL.md"; then
    info "Edit SOUL.md later to customise AARIA's personality."
  elif prompt_yn "Reset SOUL.md from SOUL.sample.md? (overwrites customisations)" "n"; then
    cp "$ROOT/SOUL.sample.md" "$ROOT/SOUL.md"
    ok "SOUL.md reset from sample"
  fi

  if [[ ! -f "$ROOT/USER.md" ]]; then
    if copy_if_missing "$ROOT/USER.sample.md" "$ROOT/USER.md" "USER.md"; then
      :
    fi
    configure_user_profile
  elif prompt_yn "Update USER.md name & timezone?" "y"; then
    configure_user_profile
  else
    ok "Keeping existing USER.md"
  fi

  if copy_if_missing "$ROOT/MEMORY.sample.md" "$ROOT/MEMORY.md" "MEMORY.md"; then
    info "MEMORY.md will grow as the learn loop saves work facts."
  elif prompt_yn "Reset MEMORY.md from MEMORY.sample.md?" "n"; then
    cp "$ROOT/MEMORY.sample.md" "$ROOT/MEMORY.md"
    ok "MEMORY.md reset from sample"
  fi
}

configure_mcp() {
  step "Step 5 · MCP tools (optional)"
  hr

  if [[ -f "$ROOT/.cursor/mcp.json" ]]; then
    ok ".cursor/mcp.json already exists"
    if ! prompt_yn "Re-copy from mcp.json.sample?" "n"; then
      return 0
    fi
  fi

  if prompt_yn "Enable MCP tools (memory, fetch, Home Assistant)?" "y"; then
    mkdir -p "$ROOT/.cursor"
    cp "$ROOT/.cursor/mcp.json.sample" "$ROOT/.cursor/mcp.json"
    ok "Installed .cursor/mcp.json"

    if prompt_yn "Configure Home Assistant token in .env now?" "n"; then
      local ha_url ha_token
      ha_url="$(prompt_value "HA_BASE_URL" "$(env_get_or HA_BASE_URL http://homeassistant.local:8123)")"
      ha_token="$(prompt_value "HA_API_ACCESS_TOKEN" "" 1)"
      env_set HA_BASE_URL "$ha_url"
      env_set HA_MCP_HTTP_URL "${ha_url%/}/api/mcp"
      env_set HA_API_ACCESS_TOKEN "$ha_token"
      ok "Home Assistant env vars saved"
    fi

    if ! command -v uvx >/dev/null 2>&1; then
      warn "uvx not found — mcp-server-fetch will not work until uv is installed"
    fi
  else
    info "Skipping MCP — set AARIA_MCP_ENABLED=0 or omit .cursor/mcp.json"
    if [[ -f "$ROOT/.env" ]] && prompt_yn "Set AARIA_MCP_ENABLED=0 in .env?" "n"; then
      env_set AARIA_MCP_ENABLED "0"
    fi
  fi
}

# ── CLI & PATH ──────────────────────────────────────────────────────────────────

ensure_path_in_shell() {
  local shell_rc=""
  if [[ -f "$HOME/.zshrc" ]]; then
    shell_rc="$HOME/.zshrc"
  elif [[ -f "$HOME/.bashrc" ]]; then
    shell_rc="$HOME/.bashrc"
  fi

  if [[ ":$PATH:" == *":$HOME/.local/bin:"* ]]; then
    return 0
  fi

  [[ -n "$shell_rc" ]] || return 0

  if grep -qE '^# export PATH=.*\.local/bin' "$shell_rc" 2>/dev/null; then
    if prompt_yn "Uncomment ~/.local/bin PATH line in $shell_rc?" "y"; then
      sed_inplace 's|^# export PATH=\$HOME/bin:\$HOME/.local/bin|export PATH=$HOME/bin:$HOME/.local/bin|' "$shell_rc"
      ok "Updated $shell_rc"
    fi
  elif ! grep -qE '\.local/bin' "$shell_rc" 2>/dev/null; then
    if prompt_yn "Add ~/.local/bin to PATH in $shell_rc?" "y"; then
      {
        echo ""
        echo "# Added by AARIA install-upgrade.sh"
        echo 'export PATH="$HOME/.local/bin:$PATH"'
      } >> "$shell_rc"
      ok "Appended PATH export to $shell_rc"
    fi
  fi
}

install_cli() {
  step "Step 6 · aaria CLI"
  hr
  if ! bash "$ROOT/deploy/install-cli.sh"; then
    warn "CLI symlink step failed — likely a permissions issue with the existing link."
    warn "Fix with: sudo rm -f \"\$HOME/.local/bin/aaria\""
    warn "Then re-run this script, or run: bash deploy/install-cli.sh"
  fi
  ensure_path_in_shell
  export PATH="$HOME/.local/bin:$PATH"
  if command -v aaria >/dev/null 2>&1; then
    ok "aaria available: $(command -v aaria)"
  else
    warn "aaria not on PATH yet — open a new shell or: export PATH=\"\$HOME/.local/bin:\$PATH\""
  fi
}

# ── Reinstall cleanup ─────────────────────────────────────────────────────────

file_checksum() {
  local path="$1"
  if [[ ! -e "$path" ]]; then
    printf 'MISSING'
    return 0
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$path" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$path" | awk '{print $1}'
  else
    # Fallback: size + mtime
    wc -c <"$path" | tr -d ' '; printf '+';
    stat -c '%Y' "$path" 2>/dev/null || stat -f '%m' "$path" 2>/dev/null || echo 0
  fi
}

snapshot_preserved_files() {
  PRESERVE_CHECKSUMS=()
  local rel
  for rel in "${PRESERVE_FILES[@]}"; do
    PRESERVE_CHECKSUMS+=("$(file_checksum "$ROOT/$rel")")
  done
}

verify_preserved_files() {
  local rel i=0 changed=0
  for rel in "${PRESERVE_FILES[@]}"; do
    local before="${PRESERVE_CHECKSUMS[$i]}"
    local after
    after="$(file_checksum "$ROOT/$rel")"
    if [[ "$before" != "$after" ]]; then
      fail "Preserved file changed during reinstall: $rel"
      changed=1
      SELF_CHECK_FAILURES=$((SELF_CHECK_FAILURES + 1))
    elif [[ "$before" != "MISSING" ]]; then
      ok "Preserved $rel (unchanged)"
    fi
    i=$((i + 1))
  done
  return "$changed"
}

cleanup_for_reinstall() {
  step "Step 2a · Reinstall cleanup"
  hr

  info "Will preserve local config (never touch):"
  local rel
  for rel in "${PRESERVE_FILES[@]}"; do
    if [[ -e "$ROOT/$rel" ]]; then
      printf '    %s%s%s\n' "$DIM" "$rel" "$RESET"
    fi
  done

  snapshot_preserved_files

  if systemctl --user show-environment >/dev/null 2>&1; then
    if systemctl --user is-active aria-api.service >/dev/null 2>&1; then
      info "Stopping aria-api.service…"
      systemctl --user stop aria-api.service 2>/dev/null || warn "Could not stop aria-api.service"
      ok "Service stopped"
    fi
  fi

  if [[ -d "$ROOT/node_modules" ]]; then
    info "Removing node_modules…"
    rm -rf "$ROOT/node_modules"
    ok "node_modules removed"
  else
    info "No node_modules directory to remove"
  fi

  if [[ -d "$ROOT/dist" ]]; then
    rm -rf "$ROOT/dist"
    ok "dist removed"
  fi

  ok "Cleanup complete — local config untouched"
}

# ── systemd service ───────────────────────────────────────────────────────────

install_systemd_service() {
  step "Step 7 · background service (aria-api)"
  hr

  if [[ "$OS_FAMILY" == "macos" ]]; then
    warn "Skipping systemd install on macOS (no systemd / launchd template yet)"
    info "Start the API in another terminal: npm start"
    info "Then run: aaria"
    return 0
  fi

  # Reinstall: refresh unit if it already exists; otherwise ask once.
  if [[ "$MODE" == "reinstall" ]]; then
    local unit="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/aria-api.service"
    if [[ -f "$unit" ]]; then
      info "Existing aria-api.service found — refreshing & restarting…"
    elif ! prompt_yn "No service unit yet — install aria-api.service now?" "y"; then
      info "Skipped systemd install — run manually: npm start"
      return 0
    fi
  elif ! prompt_yn "Install / update aria-api.service?" "y"; then
    info "Skipped systemd install — run manually: npm start"
    return 0
  fi

  if ! systemctl --user show-environment >/dev/null 2>&1; then
    warn "No systemd user bus — cannot start service now"
    if [[ "$MODE" == "reinstall" ]] || prompt_yn "Still write unit files for when you log in to the desktop?" "y"; then
      :
    else
      return 0
    fi
  fi

  bash "$ROOT/deploy/install-service.sh" || {
    warn "Service install had issues (often no user bus over SSH)"
    warn "Unit file may still be installed — try after desktop login:"
    warn "  systemctl --user start aria-api.service"
    return 0
  }

  if [[ "$MODE" != "reinstall" ]]; then
    if prompt_yn "Enable linger (keep service running after logout)?" "n"; then
      if command -v loginctl >/dev/null 2>&1; then
        sudo loginctl enable-linger "$(whoami)" && ok "Linger enabled for $(whoami)"
      else
        warn "loginctl not found"
      fi
    fi

    if prompt_yn "Install optional heartbeat timer (external watchdog)?" "n"; then
      bash "$ROOT/deploy/install-heartbeat-timer.sh" || warn "Heartbeat timer install failed"
    fi
  else
    # Refresh heartbeat timer only if already installed.
    local hb="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/aria-heartbeat.timer"
    if [[ -f "$hb" ]]; then
      info "Refreshing existing heartbeat timer…"
      bash "$ROOT/deploy/install-heartbeat-timer.sh" || warn "Heartbeat timer refresh failed"
    fi
  fi
}

# ── Post-install checks ─────────────────────────────────────────────────────────

wait_for_health() {
  local url="${1:-http://127.0.0.1:8788/health}"
  local tries="${2:-15}"
  local i
  for ((i = 1; i <= tries; i++)); do
    if curl -sf --max-time 3 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

self_check_fail() {
  fail "$1"
  SELF_CHECK_FAILURES=$((SELF_CHECK_FAILURES + 1))
}

run_self_check() {
  step "Step 8 · Self-check"
  hr

  SELF_CHECK_FAILURES=0
  local api_url health_url
  api_url="$(env_get_or AARIA_API_URL http://127.0.0.1:8788)"
  health_url="${api_url%/}/health"

  export PATH="$HOME/.local/bin:$PATH"

  # Critical: CLI
  if command -v aaria >/dev/null 2>&1; then
    ok "aaria CLI: $(command -v aaria)"
  else
    self_check_fail "aaria CLI not found on PATH"
  fi

  # Critical: deps
  if [[ -x "$ROOT/node_modules/.bin/tsx" ]]; then
    ok "tsx present"
  else
    self_check_fail "tsx missing after npm install"
  fi

  if [[ -d "$ROOT/node_modules" ]] && [[ -f "$ROOT/package.json" ]]; then
    ok "node_modules installed"
  else
    self_check_fail "node_modules missing"
  fi

  # Critical: .env + API key
  if [[ -f "$ROOT/.env" ]]; then
    ok ".env present"
    local key
    key="$(env_get CURSOR_API_KEY || true)"
    if is_placeholder_key "$key"; then
      self_check_fail "CURSOR_API_KEY missing or still a placeholder"
    else
      ok "CURSOR_API_KEY set (${key:0:8}…)"
    fi
  else
    self_check_fail ".env missing"
  fi

  # Optional persona (warn only)
  [[ -f "$ROOT/SOUL.md" ]]   && ok "SOUL.md present"   || warn "SOUL.md missing (optional)"
  [[ -f "$ROOT/USER.md" ]]   && ok "USER.md present"   || warn "USER.md missing (optional)"
  [[ -f "$ROOT/MEMORY.md" ]] && ok "MEMORY.md present" || warn "MEMORY.md missing (optional)"

  # Reinstall: prove local config was not touched
  if [[ "$MODE" == "reinstall" ]]; then
    verify_preserved_files || true
  fi

  # Service
  if systemctl --user show-environment >/dev/null 2>&1; then
    if systemctl --user is-active aria-api.service >/dev/null 2>&1; then
      ok "aria-api.service is active"
    else
      warn "aria-api.service is not active"
      info "Try: systemctl --user start aria-api.service"
      local unit="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/aria-api.service"
      if [[ "$MODE" == "reinstall" && -f "$unit" ]]; then
        self_check_fail "aria-api.service unit exists but is not active after reinstall"
      fi
    fi
  else
    warn "systemd user session unavailable — skipped service check"
  fi

  # HTTP health
  local health_tries=15
  if ! systemctl --user is-active aria-api.service >/dev/null 2>&1; then
    health_tries=3
  fi
  info "Waiting for ${health_url}…"
  if wait_for_health "$health_url" "$health_tries"; then
    local body
    body="$(curl -sf --max-time 5 "$health_url" || true)"
    ok "API health endpoint reachable"
    if command -v python3 >/dev/null 2>&1; then
      printf '%s\n' "$body" | python3 -m json.tool 2>/dev/null || printf '%s\n' "$body"
    else
      printf '%s\n' "$body"
    fi
    if printf '%s' "$body" | grep -q '"ok"[[:space:]]*:[[:space:]]*true'; then
      ok "health.ok = true"
    else
      self_check_fail "health response did not report ok:true"
    fi
  else
    if [[ "$MODE" == "reinstall" ]] && systemctl --user is-active aria-api.service >/dev/null 2>&1; then
      self_check_fail "Could not reach $health_url (service claims active)"
    else
      warn "Could not reach $health_url"
      warn "Start manually: systemctl --user start aria-api.service  OR  npm start"
    fi
  fi

  hr
  if [[ "$SELF_CHECK_FAILURES" -gt 0 ]]; then
    fail "Self-check failed with $SELF_CHECK_FAILURES issue(s)"
    return 1
  fi
  ok "Self-check passed — all critical checks green"
  return 0
}

# Keep name used by older docs / callers
run_post_checks() { run_self_check; }

print_summary() {
  step "Done · Next steps"
  hr
  local api_url
  api_url="$(env_get_or AARIA_API_URL http://127.0.0.1:8788)"
  local service_lines=""
  if [[ "$OS_FAMILY" == "macos" ]]; then
    service_lines=$(cat <<EOF
  ${BOLD}API${RESET}          npm start
  ${BOLD}Health${RESET}       curl -s ${api_url}/health | python3 -m json.tool
EOF
)
  else
    service_lines=$(cat <<EOF
  ${BOLD}Health${RESET}       curl -s ${api_url}/health | python3 -m json.tool
  ${BOLD}Service${RESET}      systemctl --user status aria-api.service
  ${BOLD}Logs${RESET}         journalctl --user -u aria-api.service -f
EOF
)
  fi
  cat <<EOF
${GREEN}ARIA ${MODE} complete.${RESET}

  ${BOLD}Terminal${RESET}     aaria
${service_lines}

${DIM}Edit persona:${RESET}  SOUL.md · USER.md · MEMORY.md
${DIM}Re-run anytime:${RESET} bash deploy/install-upgrade.sh
${DIM}Reinstall:${RESET}     bash deploy/install-upgrade.sh --reinstall

EOF
  if [[ "$OS_FAMILY" == "macos" ]]; then
    cat <<EOF
${YELLOW}macOS tip:${RESET} systemd is Linux-only — keep the API up with ${BOLD}npm start${RESET} (or add your own launchd plist).
${YELLOW}PATH tip:${RESET} ensure ~/.local/bin is on PATH (zsh: ~/.zshrc).
EOF
  else
    cat <<EOF
${YELLOW}SSH tip:${RESET} ensure ~/.local/bin is on PATH and use ${BOLD}systemctl --user${RESET} without sudo.
EOF
  fi
}

choose_mode_interactively() {
  # When an existing install is found and --reinstall was not passed.
  info "Existing installation detected."
  printf '\n  %s1%s) Upgrade   — update deps, optionally refresh config\n' "$BOLD" "$RESET"
  printf '  %s2%s) Reinstall — wipe node_modules & redeploy (keeps .env / SOUL / USER / MEMORY)\n' "$BOLD" "$RESET"
  printf '  %s3%s) Abort\n\n' "$BOLD" "$RESET"
  local reply
  printf 'Choose [1/2/3] (default 1): ' >/dev/tty
  read -r reply </dev/tty || reply=""
  reply="${reply:-1}"
  case "$reply" in
    1|u|U|upgrade) MODE="upgrade" ;;
    2|r|R|reinstall)
      MODE="reinstall"
      FORCE_REINSTALL=1
      ;;
    3|a|A|n|N|abort|q|Q)
      info "Aborted."
      exit 0
      ;;
    *)
      warn "Unknown choice — defaulting to upgrade"
      MODE="upgrade"
      ;;
  esac
}

# ── Main ──────────────────────────────────────────────────────────────────────

main() {
  clear >/dev/tty 2>&1 || true
  printf '\n%s%s  AARIA — guided install / upgrade / reinstall%s\n\n' "$BOLD" "$CYAN" "$RESET"
  printf '%sRepository:%s %s\n' "$DIM" "$RESET" "$ROOT"

  if [[ "$MODE" == "upgrade" && "$FORCE_REINSTALL" -eq 0 ]]; then
    choose_mode_interactively
  fi

  printf '%sMode:%s      %s\n' "$DIM" "$RESET" "$MODE"
  hr

  if [[ "$MODE" == "reinstall" ]]; then
    info "Reinstall will wipe node_modules and redeploy without changing local config."
    if ! prompt_yn "Continue with reinstall?" "y"; then
      info "Aborted."
      exit 0
    fi
  elif [[ "$MODE" == "upgrade" ]]; then
    info "Upgrade will update deps and optionally refresh config."
    if ! prompt_yn "Continue?" "y"; then
      info "Aborted."
      exit 0
    fi
  else
    info "Fresh install — you'll be guided through prerequisites, .env, persona, and service setup."
    pause
  fi

  run_prerequisite_checks

  if [[ "$MODE" == "reinstall" ]]; then
    cleanup_for_reinstall
  fi

  setup_node_and_deps

  if [[ "$MODE" != "reinstall" ]]; then
    configure_env
    configure_persona
    configure_mcp
  else
    step "Steps 3–5 · Config skipped (reinstall preserves local files)"
    hr
    ok "Keeping existing .env / SOUL.md / USER.md / MEMORY.md / mcp.json"
  fi

  install_cli
  install_systemd_service

  if ! run_self_check; then
    print_summary
    exit 1
  fi
  print_summary
}

main "$@"
