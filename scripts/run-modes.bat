@echo off
set ELECTRON_RUN_AS_NODE=
node scripts\run-mode-tests.js %*
exit /b %ERRORLEVEL%
