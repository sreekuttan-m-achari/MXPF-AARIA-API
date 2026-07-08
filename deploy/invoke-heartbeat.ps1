# POST /jobs/run id=heartbeat — equivalent to deploy/aria-heartbeat.service.in (curl oneshot).
#Requires -Version 5.1
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "_windows.ps1")

$Root = Get-AriaRoot
$apiUrl = Get-AriaApiUrl -Root $Root
$uri = "$apiUrl/jobs/run"
$body = '{"id":"heartbeat"}'

try {
    Invoke-RestMethod -Method Post -Uri $uri -ContentType "application/json" -Body $body -TimeoutSec 30 | Out-Null
    exit 0
} catch {
    Write-Error "Heartbeat POST failed ($uri): $($_.Exception.Message)"
    exit 1
}
