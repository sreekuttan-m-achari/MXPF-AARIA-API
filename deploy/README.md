# Deploy scripts — Linux/macOS vs Windows

| Linux / macOS | Windows (PowerShell) | Purpose |
|---------------|----------------------|---------|
| `bash deploy/install-upgrade.sh` | `npm run install:win` | Guided full install / upgrade |
| `bash deploy/install-cli.sh` | `npm run install-cli:win` | Install `aaria` on user PATH |
| `bash deploy/install-service.sh` | `npm run install-service:win` | Background API (systemd / Scheduled Task) |
| `bash deploy/install-heartbeat-timer.sh` | `npm run install-heartbeat:win` | External heartbeat every 5m |
| `deploy/aria-api.service.in` | `deploy/aria-api.launch.cmd.in` | Service unit template |
| `deploy/aria-heartbeat.service.in` | `deploy/invoke-heartbeat.ps1` | Oneshot heartbeat POST |
| `deploy/aria-heartbeat.timer.in` | `deploy/install-heartbeat-timer.ps1` | Recurring heartbeat schedule |

Shared Windows helpers: `deploy/_windows.ps1`

## Windows quick reference

```powershell
npm run install:win              # full guided setup
npm run install-service:win      # ARIA-API task at logon
npm run install-heartbeat:win    # ARIA-Heartbeat every 5m
npm run install-cli:win          # aaria → %USERPROFILE%\.local\bin

Get-ScheduledTask -TaskName ARIA-API
Start-ScheduledTask -TaskName ARIA-API
powershell -File deploy\invoke-heartbeat.ps1
```

## Linux quick reference

```bash
bash deploy/install-upgrade.sh
bash deploy/install-service.sh
bash deploy/install-heartbeat-timer.sh
npm run install-cli

systemctl --user status aria-api.service
journalctl --user -u aria-api.service -f
```
