# Deploy scripts — Linux / macOS / Windows

| Linux | macOS | Windows (PowerShell) | Purpose |
|-------|-------|----------------------|---------|
| `bash deploy/install-upgrade.sh` | same | `npm run install:win` | Guided full install / upgrade |
| `bash deploy/install-upgrade.sh --reinstall` | same | `npm run install:win -- -Reinstall` | Clean redeploy; keep local config |
| `bash deploy/install-cli.sh` | same | `npm run install-cli:win` | Install `aaria` on user PATH |
| `bash deploy/install-service.sh` | use `npm start` | `npm run install-service:win` | Background API |
| `bash deploy/install-heartbeat-timer.sh` | in-process scheduler | `npm run install-heartbeat:win` | External heartbeat every 5m |

Shared Windows helpers: `deploy/_windows.ps1`

## Platform notes

| Capability | Linux | macOS | Windows |
|------------|-------|-------|---------|
| Guided install / reinstall | ✓ | ✓ | ✓ |
| CLI (`aaria` → `~/.local/bin`) | ✓ | ✓ | `%USERPROFILE%\.local\bin` |
| Background API | systemd user service | **`npm start`** (no launchd yet) | Scheduled Task |
| External heartbeat timer | systemd timer | in-process scheduler / cron | Scheduled Task |

macOS uses the same bash installer. Differences handled automatically:
- portable `sed` / Bash 3.2-safe prompts
- port check via `lsof` (no `ss`)
- checksums via `shasum` (no `sha256sum`)
- **skips systemd** Step 7 and points you at `npm start`

## Reinstall mode (Option A)

Wipes `node_modules` (and `dist` if present), reinstalls deps, refreshes the CLI symlink, and restarts the service if it was already installed (Linux/Windows). Runs a **self-check** at the end.

**Never touches:** `.env`, `SOUL.md`, `USER.md`, `MEMORY.md`, `.cursor/mcp.json`, `.aria-conversations.ndjson`, `.aria-learn-pending.json`.

```bash
bash deploy/install-upgrade.sh --reinstall
# or
npm run install -- --reinstall
```

## macOS quick reference

```bash
# Prerequisites: Node ≥ 22.13 (nvm recommended), git, curl
bash deploy/install-upgrade.sh
# or reinstall without touching .env / persona files:
bash deploy/install-upgrade.sh --reinstall

npm run install-cli              # aaria → ~/.local/bin
# ensure PATH (zsh default on modern macOS):
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc

# API (foreground — no systemd on macOS)
npm start                        # → http://127.0.0.1:8788
# another terminal:
aaria

curl -s http://127.0.0.1:8788/health | python3 -m json.tool
```

## Linux quick reference

```bash
bash deploy/install-upgrade.sh
bash deploy/install-upgrade.sh --reinstall
bash deploy/install-service.sh
bash deploy/install-heartbeat-timer.sh
npm run install-cli

systemctl --user status aria-api.service
journalctl --user -u aria-api.service -f
```

## Windows quick reference

```powershell
npm run install:win              # full guided setup
npm run install:win -- -Reinstall
npm run install-service:win      # ARIA-API task at logon
npm run install-heartbeat:win    # ARIA-Heartbeat every 5m
npm run install-cli:win          # aaria → %USERPROFILE%\.local\bin

Get-ScheduledTask -TaskName ARIA-API
Start-ScheduledTask -TaskName ARIA-API
powershell -File deploy\invoke-heartbeat.ps1
```
