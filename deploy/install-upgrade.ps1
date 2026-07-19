# Guided interactive install / upgrade / reinstall for AARIA (API + aaria TUI) on Windows.
#Requires -Version 5.1
param(
    [switch]$Reinstall,
    [Alias("h")]
    [switch]$Help
)
$ErrorActionPreference = "Stop"

if ($Help) {
    Write-Host @"
AARIA guided install / upgrade / reinstall (Windows)

  powershell -File deploy\install-upgrade.ps1
  powershell -File deploy\install-upgrade.ps1 -Reinstall

Reinstall wipes node_modules (+ dist) and redeploys. Never touches:
  .env  SOUL.md  USER.md  MEMORY.md  .cursor\mcp.json
  .aria-conversations.ndjson  .aria-learn-pending.json
"@
    exit 0
}

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $Root

$Script:Issues = 0
$Script:Warnings = 0
$Script:SelfCheckFailures = 0
$Script:PreserveFiles = @(
    ".env",
    "SOUL.md",
    "USER.md",
    "MEMORY.md",
    ".cursor\mcp.json",
    ".aria-conversations.ndjson",
    ".aria-learn-pending.json"
)
$Script:PreserveChecksums = @{}

function Write-Step([string]$Text) { Write-Host ""; Write-Host $Text -ForegroundColor White }
function Write-Hr() { Write-Host ("─" * 48) -ForegroundColor DarkGray }
function Write-Info([string]$Text) { Write-Host "→ $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "✓ $Text" -ForegroundColor Green }
function Write-Warn([string]$Text) { Write-Host "! $Text" -ForegroundColor Yellow; $Script:Warnings++ }
function Write-Fail([string]$Text) { Write-Host "✗ $Text" -ForegroundColor Red; $Script:Issues++ }

function Prompt-YesNo([string]$Question, [string]$Default = "y") {
    $hint = if ($Default -eq "y") { "Y/n" } else { "y/N" }
    while ($true) {
        $reply = Read-Host "$Question [$hint]"
        if ([string]::IsNullOrWhiteSpace($reply)) { $reply = $Default }
        switch ($reply.ToLower()) {
            { $_ -in "y", "yes" } { return $true }
            { $_ -in "n", "no" } { return $false }
            default { Write-Warn "Please answer y or n." }
        }
    }
}

function Prompt-Value([string]$Question, [string]$Default = "", [switch]$Secret) {
    if ($Secret) {
        $sec = Read-Host $Question -AsSecureString
        $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
        try {
            $value = [Runtime.InteropServices.Marshal]::PtrToStringAuto($ptr)
        } finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
        }
        if ([string]::IsNullOrWhiteSpace($value)) { return $Default }
        return $value
    }
    if ($Default) {
        $value = Read-Host "$Question [$Default]"
    } else {
        $value = Read-Host $Question
    }
    if ([string]::IsNullOrWhiteSpace($value)) { return $Default }
    return $value
}

function Pause-Continue() {
    [void](Read-Host "Press Enter to continue")
}

function Get-EnvValue([string]$Key, [string]$File = (Join-Path $Root ".env")) {
    if (-not (Test-Path $File)) { return "" }
    foreach ($line in Get-Content $File -Encoding UTF8) {
        if ($line -match "^\s*$Key=(.*)$") {
            return $Matches[1].Trim().Trim('"').Trim("'")
        }
    }
    return ""
}

function Set-EnvValue([string]$Key, [string]$Value, [string]$File = (Join-Path $Root ".env")) {
    $escaped = $Value -replace '"', '\"'
    $newLine = "$Key=$escaped"
    if (Test-Path $File) {
        $lines = Get-Content $File -Encoding UTF8
        $found = $false
        $out = foreach ($line in $lines) {
            if ($line -match "^\s*$([regex]::Escape($Key))=") {
                $found = $true
                $newLine
            } else {
                $line
            }
        }
        if (-not $found) { $out += $newLine }
        $out | Set-Content $File -Encoding UTF8
    } else {
        Set-Content $File $newLine -Encoding UTF8
    }
}

function Test-PlaceholderKey([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return $true }
    if ($Value -eq "cursor_api_key_here") { return $true }
    if ($Value -like "*your_*") { return $true }
    return $false
}

function Test-NodeVersion {
    try {
        $ver = (node -v 2>$null).TrimStart("v")
        if (-not $ver) { throw "empty version" }
        $parts = $ver.Split(".")
        $major = [int]$parts[0]
        $minor = if ($parts.Length -gt 1) { [int]$parts[1] } else { 0 }
        if ($major -lt 22 -or ($major -eq 22 -and $minor -lt 13)) {
            Write-Fail "Node v$ver — need >= 22.13 (see .nvmrc)"
            return $false
        }
        Write-Ok "Node v$ver ($(Get-Command node).Source)"
        return $true
    } catch {
        Write-Fail "node not found or invalid version"
        return $false
    }
}

function Test-CommandExists([string]$Name, [string]$Label = $Name) {
    if (Get-Command $Name -ErrorAction SilentlyContinue) {
        Write-Ok "$Label found ($((Get-Command $Name).Source))"
        return $true
    }
    Write-Fail "$Label not found"
    return $false
}

function Test-Port8788 {
    try {
        $inUse = Get-NetTCPConnection -LocalPort 8788 -State Listen -ErrorAction SilentlyContinue
        if ($inUse) {
            Write-Warn "Port 8788 is already in use"
            return $false
        }
        Write-Ok "Port 8788 appears free"
        return $true
    } catch {
        Write-Ok "Port 8788 check skipped (Get-NetTCPConnection unavailable)"
        return $true
    }
}

function Test-AariaOnPath {
    $binDir = Join-Path $env:USERPROFILE ".local\bin"
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -like "*$binDir*" -or $env:Path -like "*$binDir*") {
        Write-Ok "$binDir is on PATH"
        return $true
    }
    Write-Warn "$binDir is not on user PATH — 'aaria' may not be found in new terminals"
    return $false
}

function Invoke-PrerequisiteChecks {
    Write-Step "Step 1 · Prerequisites"
    Write-Hr
    Test-CommandExists "git" | Out-Null
    Test-CommandExists "npm" | Out-Null
    Test-NodeVersion | Out-Null
    Test-Port8788 | Out-Null
    Test-AariaOnPath | Out-Null

    if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue) -and
        -not (Get-Command Invoke-WebRequest -ErrorAction SilentlyContinue)) {
        Write-Warn "curl / Invoke-WebRequest not available — health checks may fail"
    } else {
        Write-Ok "HTTP client available"
    }

    if ($Script:Issues -gt 0) {
        Write-Fail "$($Script:Issues) blocking issue(s). Fix them and re-run."
        exit 1
    }
    if ($Script:Warnings -eq 0) {
        Write-Ok "All prerequisite checks passed"
    }
}

function Invoke-SetupNodeAndDeps {
    Write-Step "Step 2 · Node.js & dependencies"
    Write-Hr

    if (Test-Path (Join-Path $env:USERPROFILE ".nvm\settings.txt")) {
        Write-Info "nvm-windows detected — ensure Node 22.13+ is active: nvm use 22"
    }

    Write-Info "Running npm install…"
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
    Write-Ok "npm dependencies installed"

    $tsx = Join-Path $Root "node_modules\.bin\tsx.cmd"
    if (-not (Test-Path $tsx)) { $tsx = Join-Path $Root "node_modules\.bin\tsx" }
    if (-not (Test-Path $tsx)) { throw "tsx missing after npm install" }
    Write-Ok "tsx ready"
}

function Get-FileChecksum([string]$Path) {
    if (-not (Test-Path $Path)) { return "MISSING" }
    return (Get-FileHash -Algorithm SHA256 -Path $Path).Hash
}

function Save-PreserveSnapshot {
    $Script:PreserveChecksums = @{}
    foreach ($rel in $Script:PreserveFiles) {
        $Script:PreserveChecksums[$rel] = Get-FileChecksum (Join-Path $Root $rel)
    }
}

function Test-PreserveUnchanged {
    foreach ($rel in $Script:PreserveFiles) {
        $before = $Script:PreserveChecksums[$rel]
        $after = Get-FileChecksum (Join-Path $Root $rel)
        if ($before -ne $after) {
            Write-Fail "Preserved file changed during reinstall: $rel"
            $Script:SelfCheckFailures++
        } elseif ($before -ne "MISSING") {
            Write-Ok "Preserved $rel (unchanged)"
        }
    }
}

function Invoke-CleanupForReinstall {
    Write-Step "Step 2a · Reinstall cleanup"
    Write-Hr
    Write-Info "Will preserve local config (never touch):"
    foreach ($rel in $Script:PreserveFiles) {
        if (Test-Path (Join-Path $Root $rel)) {
            Write-Host "    $rel" -ForegroundColor DarkGray
        }
    }
    Save-PreserveSnapshot

    $nm = Join-Path $Root "node_modules"
    if (Test-Path $nm) {
        Write-Info "Removing node_modules…"
        Remove-Item -Recurse -Force $nm
        Write-Ok "node_modules removed"
    } else {
        Write-Info "No node_modules directory to remove"
    }

    $dist = Join-Path $Root "dist"
    if (Test-Path $dist) {
        Remove-Item -Recurse -Force $dist
        Write-Ok "dist removed"
    }
    Write-Ok "Cleanup complete — local config untouched"
}

function Invoke-ConfigureEnv {
    Write-Step "Step 3 · Configuration (.env)"
    Write-Hr

    $envFile = Join-Path $Root ".env"
    if (-not (Test-Path $envFile)) {
        Copy-Item (Join-Path $Root ".env-sample") $envFile
        Write-Ok "Created .env from .env-sample"
    } else {
        Write-Ok ".env already exists"
        if ($Script:Mode -eq "upgrade" -and -not (Prompt-YesNo "Review / update .env settings?" "n")) {
            Write-Info "Keeping existing .env"
            return
        }
    }

    $existingKey = Get-EnvValue "CURSOR_API_KEY"
    if (Test-PlaceholderKey $existingKey) {
        Write-Warn "CURSOR_API_KEY is missing or still a placeholder"
        do {
            $currentKey = Prompt-Value "Enter your CURSOR_API_KEY" "" -Secret
        } while (Test-PlaceholderKey $currentKey)
        Set-EnvValue "CURSOR_API_KEY" $currentKey
        Write-Ok "CURSOR_API_KEY saved"
    } else {
        $preview = if ($existingKey.Length -gt 8) { $existingKey.Substring(0, 8) + "…" } else { "set" }
        Write-Ok "CURSOR_API_KEY already set ($preview)"
        if (Prompt-YesNo "Replace CURSOR_API_KEY?" "n") {
            $currentKey = Prompt-Value "Enter new CURSOR_API_KEY" "" -Secret
            Set-EnvValue "CURSOR_API_KEY" $currentKey
            Write-Ok "CURSOR_API_KEY updated"
        }
    }

    if (Prompt-YesNo "Configure optional API URL / port?" "n") {
        $bindHost = Prompt-Value "AARIA_WS_HOST" (Get-EnvValue "AARIA_WS_HOST"); if (-not $bindHost) { $bindHost = "127.0.0.1" }
        $port = Prompt-Value "AARIA_WS_PORT" (Get-EnvValue "AARIA_WS_PORT"); if (-not $port) { $port = "8788" }
        $url = Prompt-Value "AARIA_API_URL" "http://${bindHost}:$port"
        Set-EnvValue "AARIA_WS_HOST" $bindHost
        Set-EnvValue "AARIA_WS_PORT" $port
        Set-EnvValue "AARIA_API_URL" $url
        Write-Ok "Network settings saved"
    }

    if (Prompt-YesNo "Enable learn loop (post-turn MEMORY.md review)?" "y") {
        Set-EnvValue "AARIA_LEARN_REVIEW" "1"
    } else {
        Set-EnvValue "AARIA_LEARN_REVIEW" "0"
    }

    if (Prompt-YesNo "Require approval before writing learned facts?" "n") {
        Set-EnvValue "AARIA_LEARN_APPROVAL" "1"
    } else {
        Set-EnvValue "AARIA_LEARN_APPROVAL" "0"
    }

    Write-Ok ".env configuration complete"
}

function Copy-IfMissing([string]$Sample, [string]$Target, [string]$Label) {
    if (Test-Path $Target) {
        Write-Ok "$Label already exists ($Target)"
        return $false
    }
    Copy-Item $Sample $Target
    Write-Ok "Created $Label from sample"
    return $true
}

function Invoke-ConfigureUserProfile {
    $callName = Prompt-Value "What should AARIA call you? (USER.md **Call me:**)" "Sree"
    $timezone = Prompt-Value "Your timezone (USER.md **Timezone:**)" "Asia/Kolkata"
    $userFile = Join-Path $Root "USER.md"

    if (Test-Path $userFile) {
        $content = Get-Content $userFile -Raw -Encoding UTF8
        $content = $content -replace '(?m)^\*\*Call me:\*\*.*', "**Call me:** $callName"
        $content = $content -replace '(?m)^\*\*Timezone:\*\*.*', "**Timezone:** $timezone"
        Set-Content $userFile $content -Encoding UTF8 -NoNewline
    } else {
        @"
**Call me:** $callName
**Timezone:** $timezone

## Context

- **ARIA** — work desk assistant (DevOps, coding, servers, planning)
- **Amelia** — home/personal assistant (port 8787)

## Preferences

- Concise replies; expand when asked
- Flag prod/destructive ops before executing
"@ | Set-Content $userFile -Encoding UTF8
    }
    Write-Ok "USER.md configured (Call me: $callName, Timezone: $timezone)"
}

function Invoke-ConfigurePersona {
    Write-Step "Step 4 · Persona & memory (SOUL · USER · MEMORY)"
    Write-Hr

    $soul = Join-Path $Root "SOUL.md"
    $user = Join-Path $Root "USER.md"
    $memory = Join-Path $Root "MEMORY.md"

    if (Copy-IfMissing (Join-Path $Root "SOUL.sample.md") $soul "SOUL.md") {
        Write-Info "Edit SOUL.md later to customise AARIA's personality."
    } elseif (Prompt-YesNo "Reset SOUL.md from SOUL.sample.md? (overwrites customisations)" "n") {
        Copy-Item (Join-Path $Root "SOUL.sample.md") $soul -Force
        Write-Ok "SOUL.md reset from sample"
    }

    if (-not (Test-Path $user)) {
        Copy-IfMissing (Join-Path $Root "USER.sample.md") $user "USER.md" | Out-Null
        Invoke-ConfigureUserProfile
    } elseif (Prompt-YesNo "Update USER.md name & timezone?" "y") {
        Invoke-ConfigureUserProfile
    } else {
        Write-Ok "Keeping existing USER.md"
    }

    if (Copy-IfMissing (Join-Path $Root "MEMORY.sample.md") $memory "MEMORY.md") {
        Write-Info "MEMORY.md will grow as the learn loop saves work facts."
    } elseif (Prompt-YesNo "Reset MEMORY.md from MEMORY.sample.md?" "n") {
        Copy-Item (Join-Path $Root "MEMORY.sample.md") $memory -Force
        Write-Ok "MEMORY.md reset from sample"
    }
}

function Invoke-ConfigureMcp {
    Write-Step "Step 5 · MCP tools (optional)"
    Write-Hr

    $mcpFile = Join-Path $Root ".cursor\mcp.json"
    if (Test-Path $mcpFile) {
        Write-Ok ".cursor\mcp.json already exists"
        if (-not (Prompt-YesNo "Re-copy from mcp.json.sample?" "n")) { return }
    }

    if (Prompt-YesNo "Enable MCP tools (memory, fetch, Home Assistant)?" "y") {
        New-Item -ItemType Directory -Force -Path (Join-Path $Root ".cursor") | Out-Null
        Copy-Item (Join-Path $Root ".cursor\mcp.json.sample") $mcpFile -Force
        Write-Ok "Installed .cursor\mcp.json"

        if (Prompt-YesNo "Configure Home Assistant token in .env now?" "n") {
            $haUrl = Prompt-Value "HA_BASE_URL" (Get-EnvValue "HA_BASE_URL")
            if (-not $haUrl) { $haUrl = "http://homeassistant.local:8123" }
            $haToken = Prompt-Value "HA_API_ACCESS_TOKEN" "" -Secret
            Set-EnvValue "HA_BASE_URL" $haUrl
            Set-EnvValue "HA_MCP_HTTP_URL" ($haUrl.TrimEnd("/") + "/api/mcp")
            Set-EnvValue "HA_API_ACCESS_TOKEN" $haToken
            Write-Ok "Home Assistant env vars saved"
        }

        if (-not (Get-Command uvx -ErrorAction SilentlyContinue)) {
            Write-Warn "uvx not found — mcp-server-fetch needs uv: https://docs.astral.sh/uv/"
        }
    } else {
        Write-Info "Skipping MCP"
        if ((Test-Path (Join-Path $Root ".env")) -and (Prompt-YesNo "Set AARIA_MCP_ENABLED=0 in .env?" "n")) {
            Set-EnvValue "AARIA_MCP_ENABLED" "0"
        }
    }
}

function Invoke-ConfigureVoice {
    Write-Step "Step 5b · Voice reply (local TTS, optional)"
    Write-Hr

    if ($Script:Mode -eq "upgrade" -and -not (Prompt-YesNo "Review / update local voice (Piper) settings?" "n")) {
        Write-Info "Keeping existing voice settings"
        return
    }

    if (-not (Prompt-YesNo "Enable spoken replies (AARIA_VOICE + persistent Piper) in .env?" "n")) {
        Write-Info "Skipped — see README Voice reply section for Piper setup"
        return
    }

    Set-EnvValue "AARIA_VOICE" "1"
    Set-EnvValue "AARIA_TTS" "piper"
    Set-EnvValue "AARIA_PIPER_PERSISTENT" "1"
    Write-Ok "Voice env enabled (persistent Piper)"
    Write-Info "Install piper-tts and an .onnx voice; set AARIA_PIPER_MODEL — see README."
    Write-Info "Audio playback on Windows may need a compatible player; Linux desktops use paplay."
}

function Invoke-InstallCli {
    Write-Step "Step 6 · aaria CLI"
    Write-Hr
    & (Join-Path $PSScriptRoot "install-cli.ps1")
    $shim = Join-Path $env:USERPROFILE ".local\bin\aaria.cmd"
    if (Test-Path $shim) {
        Write-Ok "aaria shim: $shim"
    } else {
        Write-Warn "aaria shim not found — re-run deploy\install-cli.ps1"
    }
}

function Invoke-InstallService {
    Write-Step "Step 7 · Background service (Scheduled Task)"
    Write-Hr

    $existing = Get-ScheduledTask -TaskName "ARIA-API" -ErrorAction SilentlyContinue
    if ($Script:Mode -eq "reinstall") {
        if ($existing) {
            Write-Info "Existing ARIA-API task found — refreshing…"
        } elseif (-not (Prompt-YesNo "No ARIA-API task yet — register scheduled task now?" "y")) {
            Write-Info "Skipped — run in foreground: npm start"
            return
        }
    } elseif (-not (Prompt-YesNo "Register ARIA-API scheduled task (start at logon)?" "y")) {
        Write-Info "Skipped — run in foreground: npm start"
        return
    }

    try {
        & (Join-Path $PSScriptRoot "install-service.ps1")
        Write-Ok "Scheduled task installed"
    } catch {
        Write-Warn "Scheduled task install failed: $($_.Exception.Message)"
        Write-Info "Run manually: npm start"
        return
    }

    if ($Script:Mode -eq "reinstall") {
        $hb = Get-ScheduledTask -TaskName "ARIA-Heartbeat" -ErrorAction SilentlyContinue
        if ($hb) {
            try {
                & (Join-Path $PSScriptRoot "install-heartbeat-timer.ps1")
                Write-Ok "ARIA-Heartbeat task refreshed"
            } catch {
                Write-Warn "Heartbeat timer refresh failed: $($_.Exception.Message)"
            }
        }
    } elseif (Prompt-YesNo "Install optional heartbeat timer (external watchdog every 5m)?" "n") {
        try {
            & (Join-Path $PSScriptRoot "install-heartbeat-timer.ps1")
            Write-Ok "ARIA-Heartbeat task installed"
        } catch {
            Write-Warn "Heartbeat timer install failed: $($_.Exception.Message)"
        }
    }
}

function Wait-Health([string]$Url, [int]$Tries = 15) {
    for ($i = 1; $i -le $Tries; $i++) {
        try {
            $null = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
            return $true
        } catch {
            Start-Sleep -Seconds 2
        }
    }
    return $false
}

function Invoke-SelfCheck {
    Write-Step "Step 8 · Self-check"
    Write-Hr
    $Script:SelfCheckFailures = 0

    $apiUrl = Get-EnvValue "AARIA_API_URL"
    if (-not $apiUrl) { $apiUrl = "http://127.0.0.1:8788" }
    $healthUrl = "$($apiUrl.TrimEnd('/'))/health"

    $shim = Join-Path $env:USERPROFILE ".local\bin\aaria.cmd"
    if ((Test-Path $shim) -or (Get-Command aaria -ErrorAction SilentlyContinue)) {
        Write-Ok "aaria CLI installed"
    } else {
        Write-Fail "aaria CLI not found"
        $Script:SelfCheckFailures++
    }

    $tsx = Join-Path $Root "node_modules\.bin\tsx.cmd"
    if ((Test-Path $tsx) -or (Test-Path (Join-Path $Root "node_modules\.bin\tsx"))) {
        Write-Ok "tsx present"
    } else {
        Write-Fail "tsx missing"
        $Script:SelfCheckFailures++
    }

    if (Test-Path (Join-Path $Root "node_modules")) {
        Write-Ok "node_modules installed"
    } else {
        Write-Fail "node_modules missing"
        $Script:SelfCheckFailures++
    }

    $envFile = Join-Path $Root ".env"
    if (Test-Path $envFile) {
        Write-Ok ".env present"
        $key = Get-EnvValue "CURSOR_API_KEY"
        if (Test-PlaceholderKey $key) {
            Write-Fail "CURSOR_API_KEY missing or still a placeholder"
            $Script:SelfCheckFailures++
        } else {
            $preview = if ($key.Length -gt 8) { $key.Substring(0, 8) + "…" } else { "set" }
            Write-Ok "CURSOR_API_KEY set ($preview)"
        }
    } else {
        Write-Fail ".env missing"
        $Script:SelfCheckFailures++
    }

    foreach ($label in @("SOUL.md", "USER.md", "MEMORY.md")) {
        if (Test-Path (Join-Path $Root $label)) { Write-Ok "$label present" }
        else { Write-Warn "$label missing (optional)" }
    }

    if ($Script:Mode -eq "reinstall") {
        Test-PreserveUnchanged
    }

    $task = Get-ScheduledTask -TaskName "ARIA-API" -ErrorAction SilentlyContinue
    if ($task) {
        Write-Ok "ARIA-API scheduled task registered (state: $($task.State))"
    } elseif ($Script:Mode -eq "reinstall") {
        Write-Warn "ARIA-API scheduled task not registered"
    }

    $healthTries = 15
    if (-not $task -or $task.State -ne "Running") { $healthTries = 3 }
    Write-Info "Waiting for $healthUrl …"
    if (Wait-Health $healthUrl $healthTries) {
        try {
            $body = (Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 5).Content
            Write-Ok "API health endpoint reachable"
            Write-Host $body
            if ($body -match '"ok"\s*:\s*true') {
                Write-Ok "health.ok = true"
            } else {
                Write-Fail "health response did not report ok:true"
                $Script:SelfCheckFailures++
            }
        } catch {
            Write-Warn "Health reachable but response read failed"
        }
    } else {
        Write-Warn "Could not reach $healthUrl"
        Write-Info "Start manually: Start-ScheduledTask -TaskName ARIA-API  OR  npm start"
        if ($Script:Mode -eq "reinstall" -and $task -and $task.State -eq "Running") {
            Write-Fail "Could not reach health while task claims Running"
            $Script:SelfCheckFailures++
        }
    }

    Write-Hr
    if ($Script:SelfCheckFailures -gt 0) {
        Write-Fail "Self-check failed with $($Script:SelfCheckFailures) issue(s)"
        return $false
    }
    Write-Ok "Self-check passed — all critical checks green"
    return $true
}

function Invoke-PostChecks { return Invoke-SelfCheck }

function Write-Summary {
    Write-Step "Done · Next steps"
    Write-Hr
    $apiUrl = Get-EnvValue "AARIA_API_URL"
    if (-not $apiUrl) { $apiUrl = "http://127.0.0.1:8788" }

    Write-Host @"

ARIA $($Script:Mode) complete.

  Terminal       aaria          (open Windows Terminal — new window after PATH change)
  Health         Invoke-WebRequest $apiUrl/health
  Service        Get-ScheduledTask -TaskName ARIA-API
  Heartbeat      Get-ScheduledTask -TaskName ARIA-Heartbeat
  Start API      Start-ScheduledTask -TaskName ARIA-API
  Foreground     npm start

Edit persona:  SOUL.md · USER.md · MEMORY.md
Re-run:        powershell -ExecutionPolicy Bypass -File deploy\install-upgrade.ps1
Reinstall:     powershell -ExecutionPolicy Bypass -File deploy\install-upgrade.ps1 -Reinstall

Tip: TUI auto-start via systemd is Linux-only; on Windows use the scheduled task or npm start.
"@
}

# ── Main ──────────────────────────────────────────────────────────────────────

$Script:Mode = "install"
$shim = Join-Path $env:USERPROFILE ".local\bin\aaria.cmd"
if ((Test-Path (Join-Path $Root ".env")) -or (Test-Path (Join-Path $Root "node_modules")) -or (Test-Path $shim)) {
    $Script:Mode = "upgrade"
}
if ($Reinstall) { $Script:Mode = "reinstall" }

Clear-Host
Write-Host ""
Write-Host "  AARIA — guided install / upgrade / reinstall (Windows)" -ForegroundColor Cyan
Write-Host ""
Write-Host "Repository: $Root"

if ($Script:Mode -eq "upgrade" -and -not $Reinstall) {
    Write-Info "Existing installation detected."
    Write-Host ""
    Write-Host "  1) Upgrade   — update deps, optionally refresh config"
    Write-Host "  2) Reinstall — wipe node_modules & redeploy (keeps .env / SOUL / USER / MEMORY)"
    Write-Host "  3) Abort"
    Write-Host ""
    $choice = Read-Host "Choose [1/2/3] (default 1)"
    if ([string]::IsNullOrWhiteSpace($choice)) { $choice = "1" }
    switch ($choice.ToLower()) {
        { $_ -in "1", "u", "upgrade" } { $Script:Mode = "upgrade" }
        { $_ -in "2", "r", "reinstall" } { $Script:Mode = "reinstall" }
        { $_ -in "3", "a", "n", "abort", "q" } { Write-Info "Aborted."; exit 0 }
        default { Write-Warn "Unknown choice — defaulting to upgrade"; $Script:Mode = "upgrade" }
    }
}

Write-Host "Mode:       $($Script:Mode)"
Write-Hr

if ($Script:Mode -eq "reinstall") {
    Write-Info "Reinstall will wipe node_modules and redeploy without changing local config."
    if (-not (Prompt-YesNo "Continue with reinstall?" "y")) {
        Write-Info "Aborted."
        exit 0
    }
} elseif ($Script:Mode -eq "upgrade") {
    Write-Info "Upgrade will update deps and optionally refresh config."
    if (-not (Prompt-YesNo "Continue?" "y")) {
        Write-Info "Aborted."
        exit 0
    }
} else {
    Write-Info "Fresh install — prerequisites, .env, persona, CLI, and scheduled task."
    Pause-Continue
}

Invoke-PrerequisiteChecks
if ($Script:Mode -eq "reinstall") { Invoke-CleanupForReinstall }
Invoke-SetupNodeAndDeps

if ($Script:Mode -ne "reinstall") {
    Invoke-ConfigureEnv
    Invoke-ConfigurePersona
    Invoke-ConfigureMcp
    Invoke-ConfigureVoice
} else {
    Write-Step "Steps 3–5b · Config skipped (reinstall preserves local files)"
    Write-Hr
    Write-Ok "Keeping existing .env / SOUL.md / USER.md / MEMORY.md / mcp.json"
}

Invoke-InstallCli
Invoke-InstallService
$ok = Invoke-SelfCheck
Write-Summary
if (-not $ok) { exit 1 }
