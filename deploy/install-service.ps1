# Register ARIA API as a Windows Scheduled Task (runs at user logon).
# Equivalent to deploy/install-service.sh + aria-api.service.in
#Requires -Version 5.1
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "_windows.ps1")

$Root = Get-AriaRoot
$TaskName = "ARIA-API"

Assert-AriaEnvFile -Root $Root
$node = Resolve-AriaNode
$nodeVer = Test-AriaNodeVersion -NodePath $node
$tsx = Resolve-AriaTsx -Root $Root

if (Test-Path (Join-Path $env:USERPROFILE ".nvm\settings.txt")) {
    Write-Host "nvm-windows detected — ensure Node 22.13+ is active."
}

$launchDir = Join-Path $env:LOCALAPPDATA "ARIA"
New-Item -ItemType Directory -Force -Path $launchDir | Out-Null
$launchCmd = Join-Path $launchDir "launch-api.cmd"

$template = Get-Content (Join-Path $PSScriptRoot "aria-api.launch.cmd.in") -Raw -Encoding UTF8
$launchContent = $template `
    -replace "__SERVER_DIR__", $Root `
    -replace "__NODE__", $node `
    -replace "__TSX__", $tsx
Set-Content -Path $launchCmd -Value $launchContent -Encoding ASCII

$action = New-ScheduledTaskAction -Execute $launchCmd -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

Register-AriaScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger @($trigger) `
    -Settings $settings `
    -Description "ARIA work-desk API (Cursor agent on port 8788)"

Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

Write-Host "Installed scheduled task: $TaskName using $node ($nodeVer)"
Write-Host "Launch script: $launchCmd"
Write-Host ""
Write-Host "  Get-ScheduledTask -TaskName $TaskName"
Write-Host "  Start-ScheduledTask -TaskName $TaskName"
Write-Host "  Stop-ScheduledTask -TaskName $TaskName"
Write-Host "  Unregister-ScheduledTask -TaskName $TaskName -Confirm:`$false"
Write-Host ""
Write-Host "Stop any manual 'npm start' on port 8788 before using the task."
Write-Host "Or run in foreground: cd $Root; npm start"
