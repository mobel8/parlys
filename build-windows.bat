@echo off
chcp 65001 >nul 2>nul
title VoiceInk - Build Windows
cd /d "%~dp0"

echo.
echo  VoiceInk - Build Windows (.exe)
echo  ================================
echo.

:: Check Node.js
where node >nul 2>nul
if errorlevel 1 (
    echo [ERREUR] Node.js introuvable. Installez depuis https://nodejs.org
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do echo [OK] Node.js %%i

:: Install dependencies if needed
if not exist "node_modules\.bin\electron-builder.cmd" (
    echo.
    echo [1/3] Installation des dependances...
    call npm install
    if errorlevel 1 (
        echo [ERREUR] npm install a echoue.
        pause
        exit /b 1
    )
) else (
    echo [1/3] Dependances OK
)

:: Build TypeScript + Vite
echo.
echo [2/3] Compilation...
call npm run build
if errorlevel 1 (
    echo [ERREUR] Compilation echouee.
    pause
    exit /b 1
)
echo [2/3] Compilation OK

:: Build Windows installer
echo.
echo [3/3] Creation de l'installeur Windows...
call npx electron-builder --win
if errorlevel 1 (
    echo [ERREUR] Build Windows echoue.
    echo.
    echo  Verifiez que electron-builder est installe:
    echo    npm install --save-dev electron-builder
    pause
    exit /b 1
)

echo.
echo  ===================================
echo  Build termine avec succes !
echo  ===================================
echo.
echo  L'installeur se trouve dans:
echo    %cd%\release\
echo.
echo  Double-cliquez sur le .exe pour installer.
echo.

:: Open release folder
if exist "release" explorer release
pause
