@echo off
chcp 65001 >nul 2>nul
title VoiceInk - Build All Installers
cd /d "%~dp0"

echo.
echo  VoiceInk - Build All Installers
echo  ================================
echo   * Windows .exe (native)
echo   * Linux AppImage + tar.gz (cross-build; requires Dev Mode)
echo   * Linux .deb / .rpm + macOS .dmg = push a tag and let GitHub Actions build them
echo.

where node >nul 2>nul || (echo [ERREUR] Node.js introuvable. && pause && exit /b 1)
for /f "tokens=*" %%i in ('node -v') do echo [OK] Node.js %%i

if not exist "node_modules\.bin\electron-builder.cmd" (
    echo.
    echo [1/3] Installation des dependances...
    call npm ci
    if errorlevel 1 (echo [ERREUR] npm ci a echoue. && pause && exit /b 1)
) else (
    echo [1/3] Dependances OK
)

echo.
echo [2/3] Lancement du build unifie...
call node scripts\build-all.js %*
set _rc=%errorlevel%
if %_rc% neq 0 (
    echo [ERREUR] build-all a echoue avec le code %_rc%.
    pause
    exit /b %_rc%
)

echo.
echo [3/3] Release folder:
echo.
dir /b release\*.exe release\*.AppImage release\*.tar.gz 2>nul
echo.

if exist "release" explorer release
echo.
echo  ===================================
echo  Build termine.
echo  ===================================
echo.
echo  Pour les installeurs .deb / .rpm / .dmg :
echo    1. Activer le workflow GitHub Actions (.github\workflows\release.yml)
echo    2. Pousser un tag : git tag v1.0.0 ^&^& git push --tags
echo    3. Recuperer les artefacts sur github.com/mobel8/voiceink/releases
echo.
pause
