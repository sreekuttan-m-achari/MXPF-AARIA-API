@echo off
setlocal EnableExtensions
set "ROOT=%~dp0.."
for %%I in ("%ROOT%") do set "ROOT=%%~fI"
cd /d "%ROOT%"

if not exist "%ROOT%\node_modules\.bin\tsx.cmd" (
  if not exist "%ROOT%\node_modules\.bin\tsx" (
    echo Run npm install in %ROOT% first. 1>&2
    exit /b 1
  )
  set "TSX=%ROOT%\node_modules\.bin\tsx"
) else (
  set "TSX=%ROOT%\node_modules\.bin\tsx.cmd"
)

"%TSX%" "%ROOT%\src\tui\main.ts" %*
