@echo off
cd /d "%~dp0\.."
set ELECTRON_RUN_AS_NODE=
node scripts\build-loop.js %* > scripts\_build.log 2>&1
echo DONE >> scripts\_build.log
