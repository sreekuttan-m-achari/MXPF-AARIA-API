# Optional: install ARIA-Heartbeat scheduled task — external watchdog (in addition to in-process scheduler).
# Equivalent to deploy/install-heartbeat-timer.sh + aria-heartbeat.{service,timer}.in
#Requires -Version 5.1
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "_windows.ps1")

$Root = Get-AriaRoot
$TaskName = "ARIA-Heartbeat"
$script = Join-Path $PSScriptRoot "invoke-heartbeat.ps1"
$apiUrl = Get-AriaApiUrl -Root $Root

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`"" `
    -WorkingDirectory $Root

# First run ~2 min after install, then every 5 minutes (matches Linux OnBootSec=2m / OnUnitActiveSec=5m).
$start = (Get-Date).AddMinutes(2)
$trigger = New-ScheduledTaskTrigger -Once -At $start `
    -RepetitionInterval (New-TimeSpan -Minutes 5) `
    -RepetitionDuration (New-TimeSpan -Days 36500)

Register-AriaScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger @($trigger) `
    -Description "ARIA external heartbeat trigger (POST $apiUrl/jobs/run every 5m)"

Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

Write-Host "Installed scheduled task: $TaskName (POST $apiUrl/jobs/run every 5m)"
Write-Host ""
Write-Host "  Get-ScheduledTask -TaskName $TaskName"
Write-Host "  Get-ScheduledTaskInfo -TaskName $TaskName"
Write-Host "  Start-ScheduledTask -TaskName $TaskName"
Write-Host "  Unregister-ScheduledTask -TaskName $TaskName -Confirm:`$false"
Write-Host ""
Write-Host "Manual test: powershell -File deploy\invoke-heartbeat.ps1"
