# Install `aaria` terminal client to %USERPROFILE%\.local\bin
# Equivalent to deploy/install-cli.sh
#Requires -Version 5.1
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "_windows.ps1")

$Root = Get-AriaRoot
$BinDir = Join-Path $env:USERPROFILE ".local\bin"
$Shim = Join-Path $BinDir "aaria.cmd"

$null = Resolve-AriaTsx -Root $Root

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

$shimContent = @"
@echo off
setlocal EnableExtensions
set "AARIA_ROOT=$Root"
cd /d "%AARIA_ROOT%"
if exist "%AARIA_ROOT%\node_modules\.bin\tsx.cmd" (
  call "%AARIA_ROOT%\node_modules\.bin\tsx.cmd" "%AARIA_ROOT%\src\tui\main.ts" %*
) else if exist "%AARIA_ROOT%\node_modules\.bin\tsx" (
  "%AARIA_ROOT%\node_modules\.bin\tsx" "%AARIA_ROOT%\src\tui\main.ts" %*
) else (
  echo Run npm install in %AARIA_ROOT% first. 1^>^&2
  exit /b 1
)
"@

Set-Content -Path $Shim -Value $shimContent -Encoding ASCII

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$BinDir*") {
    $newPath = if ($userPath) { "$BinDir;$userPath" } else { $BinDir }
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    $env:Path = "$BinDir;$env:Path"
    Write-Host "Added $BinDir to user PATH (open a new terminal to use 'aaria' everywhere)."
}

Write-Host "Installed: $Shim"
Write-Host ""
Write-Host "Run: aaria"
