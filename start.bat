@echo off
chcp 65001 >nul 2>nul
setlocal ENABLEDELAYEDEXPANSION
title VoiceInk
cd /d "%~dp0"

set "LOG=%~dp0run.log"
echo =========================================================== > "%LOG%"
echo VoiceInk start.bat - %date% %time% >> "%LOG%"
echo =========================================================== >> "%LOG%"

echo.
echo  ============================================
echo    VoiceInk - Dictee IA (Groq Whisper Turbo)
echo  ============================================
echo.

:: ---- Kill stale instances ----
taskkill /F /IM electron.exe >nul 2>nul

:: ---- 1. Node check ----
where node >nul 2>nul
if errorlevel 1 (
    echo [ERREUR] Node.js introuvable. Installez-le depuis https://nodejs.org
    echo [ERREUR] Node.js introuvable >> "%LOG%"
    pause & exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do set NODEVER=%%i
echo  [1/4] Node.js !NODEVER!
echo [1/4] Node.js !NODEVER! >> "%LOG%"

:: ---- 2. Ensure node_modules is healthy ----
set "NEED_INSTALL=0"
set "NUKE_FIRST=0"
if not exist "node_modules"                         set "NEED_INSTALL=1"
if not exist "node_modules\.bin\tsc.cmd"            set "NEED_INSTALL=1"
if not exist "node_modules\.bin\vite.cmd"           set "NEED_INSTALL=1"
if not exist "node_modules\.bin\electron.cmd"       set "NEED_INSTALL=1"
if not exist "node_modules\electron\cli.js"         set "NEED_INSTALL=1"
if not exist "node_modules\typescript\package.json" set "NEED_INSTALL=1" & set "NUKE_FIRST=1"
if not exist "node_modules\react\package.json"      set "NEED_INSTALL=1" & set "NUKE_FIRST=1"
if not exist "node_modules\vite\package.json"       set "NEED_INSTALL=1" & set "NUKE_FIRST=1"
if not exist "node_modules\zustand\package.json"    set "NEED_INSTALL=1" & set "NUKE_FIRST=1"
if not exist "node_modules\tailwindcss\package.json" set "NEED_INSTALL=1" & set "NUKE_FIRST=1"
if not exist "node_modules\koffi\package.json"      set "NEED_INSTALL=1"

if "!NUKE_FIRST!"=="1" (
    echo  [2/4] node_modules corrompu ^(packages vides^), suppression avant reinstall...
    echo [2/4] rmdir node_modules >> "%LOG%"
    if exist package-lock.json del /q package-lock.json >nul 2>nul
    rmdir /s /q node_modules >nul 2>nul
)

if "!NEED_INSTALL!"=="1" (
    echo  [2/4] Installation des dependances ^(peut prendre 2-3 min^)...
    echo [2/4] npm install --no-audit --no-fund >> "%LOG%"
    call npm install --no-audit --no-fund >> "%LOG%" 2>&1
    if errorlevel 1 (
        echo  [ERREUR] npm install a echoue. Tentative --force...
        echo [ERREUR] npm install echec, retry --force >> "%LOG%"
        call npm install --force --no-audit --no-fund >> "%LOG%" 2>&1
        if errorlevel 1 (
            echo  [ERREUR] npm install --force a echoue. Voir run.log
            echo [ERREUR] npm install --force echec >> "%LOG%"
            pause & exit /b 1
        )
    )
    echo  [2/4] Dependances installees
) else (
    echo  [2/4] Dependances OK
    echo [2/4] node_modules OK >> "%LOG%"
)

:: Re-verify critical files after install
if not exist "node_modules\.bin\tsc.cmd" (
    echo  [ERREUR] tsc.cmd toujours introuvable apres install.
    echo [ERREUR] tsc.cmd introuvable >> "%LOG%"
    pause & exit /b 1
)

:: ---- 3. Build ----
echo  [3/4] Compilation...
if exist dist rmdir /s /q dist >nul 2>nul
mkdir dist >nul 2>nul

echo --- build:main --- >> "%LOG%"
if exist "node_modules\.bin\tsc.cmd" (
    call "node_modules\.bin\tsc.cmd" -p tsconfig.main.json >> "%LOG%" 2>&1
) else (
    call node "node_modules\typescript\lib\tsc.js" -p tsconfig.main.json >> "%LOG%" 2>&1
)
if errorlevel 1 (
    echo  [ERREUR] Compilation main ECHOUEE. Voir run.log
    echo.
    echo  Derniers errors:
    powershell -NoProfile -Command "Get-Content -Path 'run.log' -Tail 30"
    pause & exit /b 1
)

echo --- build:renderer --- >> "%LOG%"
if exist "node_modules\.bin\vite.cmd" (
    call "node_modules\.bin\vite.cmd" build >> "%LOG%" 2>&1
) else (
    call node "node_modules\vite\bin\vite.js" build >> "%LOG%" 2>&1
)
if errorlevel 1 (
    echo  [ERREUR] Compilation renderer ECHOUEE. Voir run.log
    echo.
    powershell -NoProfile -Command "Get-Content -Path 'run.log' -Tail 40"
    pause & exit /b 1
)
echo  [3/4] Build OK

:: ---- 4. Launch ----
echo  [4/4] Lancement de VoiceInk...
echo  ^(laissez cette fenetre ouverte pour voir les logs^)
echo.
echo --- launch --- >> "%LOG%"

if exist "node_modules\.bin\electron.cmd" (
    "node_modules\.bin\electron.cmd" --no-sandbox dist\main\index.js
) else if exist "node_modules\electron\cli.js" (
    node "node_modules\electron\cli.js" --no-sandbox dist\main\index.js
) else (
    echo  [ERREUR] Electron introuvable
    echo [ERREUR] electron introuvable >> "%LOG%"
    pause & exit /b 1
)

echo.
echo  VoiceInk ferme ^(code %errorlevel%^).
echo [EXIT] code %errorlevel% >> "%LOG%"
pause
