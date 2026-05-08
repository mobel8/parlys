@echo off
chcp 65001 >nul 2>nul
title VoiceInk - Build Loop
cd /d "%~dp0\.."
set ELECTRON_RUN_AS_NODE=
node scripts\build-loop.js %*
set _rc=%errorlevel%
pause
exit /b %_rc%
