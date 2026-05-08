#
# Update the VoiceInk desktop + start-menu shortcuts so they target the
# live dev launcher (D:\voiceink\dev.bat) instead of the installed
# VoiceInk.exe snapshot. Each click then runs against current source
# with HMR + auto-restart on every modification.
#
# A backup of the original shortcut(s) is saved next to each as
# `<name>.installed.lnk.bak` so the previous installer-based launcher
# can be restored if needed.
#
# Usage (from PowerShell, cmd, or WSL via powershell.exe):
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\setup-dev-shortcut.ps1
#
# Idempotent — re-running just refreshes the targets.
#

param(
  [string]$ProjectRoot = (Resolve-Path "$PSScriptRoot\..").Path
)

$ErrorActionPreference = 'Stop'

$DevBat = Join-Path $ProjectRoot 'dev.bat'
$IconPath = Join-Path $ProjectRoot 'assets\icon.ico'

if (-not (Test-Path $DevBat)) {
  throw "dev.bat not found at $DevBat"
}

$Targets = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'VoiceInk.lnk'),
  (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\VoiceInk.lnk')
)

$Sh = New-Object -ComObject WScript.Shell

foreach ($lnkPath in $Targets) {
  Write-Host "→ $lnkPath"
  if (Test-Path $lnkPath) {
    # Back up the original on first run so we don't lose the installer's
    # shortcut if we ever want to restore it.
    $bak = "$lnkPath.installed.lnk.bak"
    if (-not (Test-Path $bak)) {
      Copy-Item $lnkPath $bak -Force
      Write-Host "    backed up original to $bak"
    }
  } else {
    # Make sure the parent dir exists (start menu Programs sometimes
    # missing in fresh accounts).
    $parent = Split-Path $lnkPath -Parent
    if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  }

  $lnk = $Sh.CreateShortcut($lnkPath)
  # cmd.exe /c "<dev.bat>" — cmd is the right host for a .bat target.
  # Setting Arguments and TargetPath separately keeps quoting correct
  # when the path has spaces.
  $lnk.TargetPath = "$env:WINDIR\System32\cmd.exe"
  $lnk.Arguments = "/c """"$DevBat"""""
  $lnk.WorkingDirectory = $ProjectRoot
  if (Test-Path $IconPath) { $lnk.IconLocation = "$IconPath,0" }
  $lnk.Description = 'VoiceInk — live dev (Vite HMR + tsc-watch + Electron auto-restart)'
  # 7 = minimised window so the launcher console doesn't grab focus.
  # Change to 1 for normal window if you want to read logs as they stream.
  $lnk.WindowStyle = 7
  $lnk.Save()
  Write-Host "    target  → cmd.exe /c $DevBat"
  Write-Host "    workdir → $ProjectRoot"
}

Write-Host ''
Write-Host 'Done. Click the desktop "VoiceInk" shortcut — it will spin up Vite + tsc --watch + Electron.'
Write-Host 'Edit any file under src\, save, and the app updates automatically.'
