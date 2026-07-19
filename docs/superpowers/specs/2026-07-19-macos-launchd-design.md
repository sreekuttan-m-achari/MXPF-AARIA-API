# macOS launchd background service for AARIA API

**Date:** 2026-07-19  
**Status:** Approved (Approach A — full parity)  
**Scope:** Installer + TUI auto-start on Darwin via LaunchAgent

## Goal

When `install-upgrade.sh` / `install-service.sh` detect macOS, install and start the API as a user LaunchAgent (`com.aaria.api`), matching Linux systemd behavior. The TUI (`aaria`) auto-starts that agent when the API is down.

## Design

### LaunchAgent

| Item | Value |
|------|--------|
| Label | `com.aaria.api` (override: `AARIA_LAUNCHD_LABEL`) |
| Plist | `~/Library/LaunchAgents/com.aaria.api.plist` |
| Template | `deploy/com.aaria.api.plist.in` |
| Wrapper | `deploy/aaria-api-launch.sh` (generated at install with absolute node/tsx paths; sources `.env`) |
| RunAtLoad | true |
| KeepAlive | true |
| Logs | `~/Library/Logs/aaria/aria-api.{out,err}.log` |

### Installer

- `deploy/install-service.sh` branches: Darwin → launchd; Linux → systemd.
- `install-upgrade.sh` Step 7 calls the same script on macOS (no skip).
- Self-check probes `launchctl print gui/$UID/com.aaria.api` + health.
- Docs / next-steps tips updated.

### TUI

- `bootstrap.ts`: on `darwin`, `launchctl kickstart -k gui/$UID/<label>`; else systemd.
- Display name uses launchd label when service was auto-started.

### Out of scope

- External heartbeat LaunchAgent
- Changing Linux Node 22.x pin behavior
