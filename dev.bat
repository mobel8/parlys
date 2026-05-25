@echo off
REM ============================================================
REM  VoiceInk dev launcher — entry point for the desktop shortcut.
REM
REM  Runs scripts/dev-launcher.js, which orchestrates:
REM    - Vite dev server (renderer HMR)
REM    - tsc --watch     (main process incremental rebuilds)
REM    - Electron        (auto-restart on every main rebuild)
REM
REM  This file is what the desktop "VoiceInk" shortcut targets after
REM  scripts\setup-dev-shortcut.ps1 runs. Edit any source file under
REM  src\ and the running app updates within ~1 second.
REM ============================================================

REM cd to the directory this script lives in (project root).
cd /d "%~dp0"

REM Make sure we use the project's local Node — fall back to PATH.
if exist "node.exe" (
  set "NODE_BIN=node.exe"
) else (
  set "NODE_BIN=node"
)

title VoiceInk — Dev Launcher
%NODE_BIN% scripts\dev-launcher.js

REM Hold the window open if the launcher crashed so the user can read errors.
if errorlevel 1 (
  echo.
  echo [dev.bat] Launcher exited with errorlevel %errorlevel%
  echo Press any key to close…
  pause >nul
)
