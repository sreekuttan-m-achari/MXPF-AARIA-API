# Shared helpers for AARIA Windows deploy scripts.
#Requires -Version 5.1

function Get-AriaRoot {
    if ($PSScriptRoot) {
        return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
    }
    throw "Cannot resolve ARIA root — run from deploy\*.ps1"
}

function Get-AriaEnvValue {
    param(
        [Parameter(Mandatory)][string]$Key,
        [string]$File
    )
    if (-not $File) { $File = Join-Path (Get-AriaRoot) ".env" }
    if (-not (Test-Path $File)) { return "" }
    foreach ($line in Get-Content $File -Encoding UTF8) {
        if ($line -match "^\s*$([regex]::Escape($Key))=(.*)$") {
            return $Matches[1].Trim().Trim('"').Trim("'")
        }
    }
    return ""
}

function Resolve-AriaTsx {
    param([string]$Root = (Get-AriaRoot))
    $tsx = Join-Path $Root "node_modules\.bin\tsx.cmd"
    if (Test-Path $tsx) { return $tsx }
    $tsx = Join-Path $Root "node_modules\.bin\tsx"
    if (Test-Path $tsx) { return $tsx }
    throw "Run npm install in $Root first (tsx missing)."
}

function Resolve-AriaNode {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { throw "node not found — install Node >= 22.13 (see .nvmrc)." }
    return $node.Source
}

function Test-AriaNodeVersion {
    param([string]$NodePath = (Resolve-AriaNode))
    $ver = (& $NodePath -v 2>$null).TrimStart("v")
    if (-not $ver) { throw "Could not read node version." }
    $parts = $ver.Split(".")
    $major = [int]$parts[0]
    $minor = if ($parts.Length -gt 1) { [int]$parts[1] } else { 0 }
    if ($major -lt 22 -or ($major -eq 22 -and $minor -lt 13)) {
        throw "Expected Node >= 22.13, got v$ver at $NodePath"
    }
    return "v$ver"
}

function Get-AriaApiUrl {
    param([string]$Root = (Get-AriaRoot))
    $url = Get-AriaEnvValue -Key "AARIA_API_URL" -File (Join-Path $Root ".env")
    if ($url) { return $url.TrimEnd("/") }
    $bindHost = Get-AriaEnvValue -Key "AARIA_WS_HOST" -File (Join-Path $Root ".env")
    $port = Get-AriaEnvValue -Key "AARIA_WS_PORT" -File (Join-Path $Root ".env")
    if (-not $bindHost) { $bindHost = "127.0.0.1" }
    if (-not $port) { $port = "8788" }
    return "http://${bindHost}:$port"
}

function Assert-AriaEnvFile {
    param([string]$Root = (Get-AriaRoot))
    $envFile = Join-Path $Root ".env"
    if (-not (Test-Path $envFile)) {
        throw "Missing $envFile — copy .env-sample and set CURSOR_API_KEY first."
    }
}

function Register-AriaScheduledTask {
    param(
        [Parameter(Mandatory)][string]$TaskName,
        [Parameter(Mandatory)][object]$Action,
        [Parameter(Mandatory)][object[]]$Trigger,
        [string]$Description = "",
        [object]$Settings
    )
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($existing) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    }
    if (-not $Settings) {
        $Settings = New-ScheduledTaskSettingsSet `
            -AllowStartIfOnBatteries `
            -DontStopIfGoingOnBatteries `
            -StartWhenAvailable `
            -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
    }
    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $Action `
        -Trigger $Trigger `
        -Settings $Settings `
        -Description $Description `
        -RunLevel Limited | Out-Null
}
