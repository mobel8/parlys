param(
  [string]$ProjectRoot = (Resolve-Path "$PSScriptRoot\..").Path
)

$ErrorActionPreference = 'Stop'

$ElectronExe = Join-Path $ProjectRoot 'node_modules\electron\dist\electron.exe'
$MainEntry   = Join-Path $ProjectRoot 'dist\main\index.js'
$IconPath    = Join-Path $ProjectRoot 'assets\icon.ico'

if (-not (Test-Path $ElectronExe)) { throw "electron.exe not found at $ElectronExe" }
if (-not (Test-Path $MainEntry))   { throw "Main entry missing at $MainEntry" }

$Targets = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'VoiceInk.lnk'),
  (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\VoiceInk.lnk')
)

$Sh = New-Object -ComObject WScript.Shell

foreach ($lnkPath in $Targets) {
  Write-Host ""
  Write-Host "=> $lnkPath"
  if (Test-Path $lnkPath) {
    $bak = "$lnkPath.devbat.bak"
    if (-not (Test-Path $bak)) {
      Copy-Item $lnkPath $bak -Force
      Write-Host "    backed up dev shortcut to $bak"
    }
  } else {
    $parent = Split-Path $lnkPath -Parent
    if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  }

  $lnk = $Sh.CreateShortcut($lnkPath)
  $lnk.TargetPath       = $ElectronExe
  $lnk.Arguments        = '"' + $MainEntry + '"'
  $lnk.WorkingDirectory = $ProjectRoot
  if (Test-Path $IconPath) { $lnk.IconLocation = "$IconPath,0" }
  $lnk.Description      = 'VoiceInk - dictee IA (lancement direct, sans console)'
  $lnk.WindowStyle      = 1
  $lnk.Save()
  Write-Host "    target  -> $ElectronExe"
  Write-Host "    args    -> $($lnk.Arguments)"
  Write-Host "    workdir -> $ProjectRoot"
}

Write-Host ""
Write-Host "Done. Click VoiceInk on the Desktop, the app opens directly without any CMD window."
