@echo off
REM One-shot dev loop: rebuild dist/, patch the installed app.asar, relaunch.
REM Use this instead of rerunning the NSIS installer every time you
REM want the desktop shortcut to pick up a code change.
setlocal

call "%~dp0build.bat"
if errorlevel 1 (
  echo [sync-install] build failed, aborting.
  exit /b %errorlevel%
)

node "%~dp0sync-install.js"
exit /b %ERRORLEVEL%
