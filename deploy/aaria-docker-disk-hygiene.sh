#!/usr/bin/env bash
# Daily Docker disk check + safe cleanup for the office Mac work desk.
# Matches the manual hygiene run: prune unused images/cache; leave volumes alone.
# Does NOT stop Docker Desktop or rewrite Docker.raw (needs ~2× free space).
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

LOG_DIR="${HOME}/Library/Logs/aaria"
LOG_FILE="${LOG_DIR}/docker-disk-hygiene.log"
mkdir -p "$LOG_DIR"

FREE_WARN_GIB="${AARIA_DISK_FREE_WARN_GIB:-15}"
FREE_CRIT_GIB="${AARIA_DISK_FREE_CRIT_GIB:-8}"

ts() { date '+%Y-%m-%d %H:%M:%S %Z'; }

log() {
  local line="[$(ts)] $*"
  printf '%s\n' "$line" | tee -a "$LOG_FILE"
}

free_gib() {
  # Prefer Data volume (APFS); fall back to /
  local avail
  avail="$(df -g /System/Volumes/Data 2>/dev/null | awk 'NR==2 {print $4}')"
  if [[ -z "${avail:-}" || ! "$avail" =~ ^[0-9]+$ ]]; then
    avail="$(df -g / | awk 'NR==2 {print $4}')"
  fi
  printf '%s' "${avail:-0}"
}

disk_line() {
  df -h /System/Volumes/Data 2>/dev/null | awk 'NR==2 {print}' || df -h / | awk 'NR==2 {print}'
}

raw_du() {
  local raw="${HOME}/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw"
  if [[ -f "$raw" ]]; then
    du -h "$raw" 2>/dev/null | awk '{print $1}'
  else
    echo "n/a"
  fi
}

log "======== docker-disk-hygiene start ========"
log "host disk: $(disk_line)"
log "Docker.raw on-disk: $(raw_du)"

FREE="$(free_gib)"
if (( FREE < FREE_CRIT_GIB )); then
  log "CRITICAL: only ${FREE} Gi free (threshold ${FREE_CRIT_GIB} Gi)"
elif (( FREE < FREE_WARN_GIB )); then
  log "WARN: only ${FREE} Gi free (threshold ${FREE_WARN_GIB} Gi)"
else
  log "OK: ${FREE} Gi free"
fi

if ! command -v docker >/dev/null 2>&1; then
  log "SKIP: docker not on PATH"
  log "======== docker-disk-hygiene end ========"
  exit 0
fi

if ! docker info >/dev/null 2>&1; then
  log "SKIP: Docker engine not running"
  log "======== docker-disk-hygiene end ========"
  exit 0
fi

log "docker system df (before):"
docker system df 2>&1 | tee -a "$LOG_FILE" || true

log "docker system prune -af"
docker system prune -af 2>&1 | tee -a "$LOG_FILE" || true

log "docker builder prune -af"
docker builder prune -af 2>&1 | tee -a "$LOG_FILE" || true

# Best-effort TRIM inside the Linux VM (safe; no host rewrite).
# Off by default — needs a privileged helper image pull; enable with AARIA_DOCKER_FSTRIM=1.
if [[ "${AARIA_DOCKER_FSTRIM:-0}" == "1" ]]; then
  log "fstrim /var/lib (best-effort)"
  docker run --rm --privileged --pid=host alpine:3.20 sh -c '
    apk add --no-cache util-linux >/dev/null 2>&1
    nsenter -t 1 -m sh -c "fstrim -v /var/lib" 2>&1 || true
  ' 2>&1 | tee -a "$LOG_FILE" || log "fstrim skipped/failed"
else
  log "fstrim skipped (set AARIA_DOCKER_FSTRIM=1 to enable)"
fi

log "docker system df (after):"
docker system df 2>&1 | tee -a "$LOG_FILE" || true
log "host disk: $(disk_line)"
log "Docker.raw on-disk: $(raw_du)"
log "======== docker-disk-hygiene end ========"
