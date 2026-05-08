@echo off
cd /d "%~dp0\.."
set ELECTRON_RUN_AS_NODE=
echo == build:main + build:renderer ==
call npm run build
if errorlevel 1 exit /b 1
echo == sync-install ==
node scripts\sync-install.js
exit /b %errorlevel%
