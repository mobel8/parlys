@echo off
:: Unifie avec start.bat — delegue tout a start.bat qui fait setup + build + launch.
cd /d "%~dp0"
call start.bat %*
exit /b %errorlevel%

:: (script historique conserve ci-dessous mais non execute)
setlocal ENABLEDELAYEDEXPANSION
title VoiceInk - Setup

set "LOG=%~dp0run.log"
echo =========================================================== > "%LOG%"
echo VoiceInk SETUP - %date% %time% >> "%LOG%"
echo =========================================================== >> "%LOG%"

echo.
echo  VoiceInk - Setup complet
echo  ========================
echo.

:: ---- 1. Node check ----
where node >nul 2>nul
if errorlevel 1 (
    echo [ERREUR] Node.js introuvable. Installez depuis https://nodejs.org
    echo [ERREUR] Node.js introuvable >> "%LOG%"
    pause & exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do set NODEVER=%%i
echo [1/5] Node.js %NODEVER%
echo [1/5] Node.js %NODEVER% >> "%LOG%"

:: ---- 2. Kill stale electron ----
taskkill /F /IM electron.exe >nul 2>nul

:: ---- 3. Force reinstall if .bin missing ----
if not exist "node_modules\.bin\tsc.cmd" (
    echo [2/5] node_modules\.bin incomplet, reinstallation forcee...
    echo [2/5] npm install --force >> "%LOG%"
    call npm install --force --no-audit --no-fund >> "%LOG%" 2>&1
    if errorlevel 1 (
        echo [ERREUR] npm install a echoue. Voir run.log
        pause & exit /b 1
    )
) else (
    echo [2/5] node_modules\.bin OK
    echo [2/5] node_modules\.bin OK >> "%LOG%"
)

:: Double-check tsc now exists
if not exist "node_modules\.bin\tsc.cmd" (
    echo [ERREUR] tsc toujours introuvable apres npm install
    echo [ERREUR] tsc introuvable >> "%LOG%"
    pause & exit /b 1
)

:: ---- 4. Build main ----
echo [3/5] Compilation main process (TypeScript)...
echo [3/5] BUILD MAIN >> "%LOG%"
echo --- build:main --- >> "%LOG%"
if exist dist rmdir /s /q dist >nul 2>nul
call "node_modules\.bin\tsc.cmd" -p tsconfig.main.json >> "%LOG%" 2>&1
if errorlevel 1 (
    echo [ERREUR] Compilation main ECHOUEE. Voir run.log
    type "%LOG%" | more
    pause & exit /b 1
)

:: ---- 5. Build renderer ----
echo [4/5] Compilation renderer (Vite)...
echo --- build:renderer --- >> "%LOG%"
call "node_modules\.bin\vite.cmd" build >> "%LOG%" 2>&1
if errorlevel 1 (
    echo [ERREUR] Compilation renderer ECHOUEE. Voir run.log
    pause & exit /b 1
)

echo [5/5] Build OK
echo [5/5] BUILD OK >> "%LOG%"

:: ---- 6. Copy assets into dist so renderer can find them in prod ----
if not exist "dist\assets" mkdir "dist\assets" >nul 2>nul
xcopy /y /q assets\*.* dist\assets\ >nul 2>nul

:: ---- 7. Launch Electron ----
echo.
echo  Lancement de VoiceInk...
echo  =========================
echo.
echo --- launch --- >> "%LOG%"

:: Prefer .cmd shim, fallback to node cli.js
if exist "node_modules\.bin\electron.cmd" (
    "node_modules\.bin\electron.cmd" --no-sandbox dist\main\index.js
) else if exist "node_modules\electron\cli.js" (
    node "node_modules\electron\cli.js" --no-sandbox dist\main\index.js
) else (
    echo [ERREUR] Electron introuvable dans node_modules
    echo [ERREUR] electron introuvable >> "%LOG%"
    pause & exit /b 1
)

echo.
echo [EXIT] Electron ferme (code %errorlevel%)
echo [EXIT] code %errorlevel% >> "%LOG%"
pause
