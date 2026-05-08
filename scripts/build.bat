@echo off
set NODE_OPTIONS=--max-old-space-size=8192
call npm run build
exit /b %ERRORLEVEL%
