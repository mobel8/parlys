<#
.SYNOPSIS
  Reverts ALL changes tagged [EXPERIMENT:refonte-v1] across the parlys repo.
.DESCRIPTION
  - Scans src/, index.html and other root files for the tag
  - Lists every hit per-file
  - Asks for confirmation
  - Removes:
      * CSS block comments  /* [EXPERIMENT:refonte-v1] ... */ + following { ... } rule
      * TS/TSX/JS line comments // [EXPERIMENT:refonte-v1] (range=N) + N following lines
      * Whole files whose first non-empty line carries the tag (or are listed in $WholeFiles)
  - Shows a before/after unified-ish diff
  - Runs `npm run build` to verify
#>

[CmdletBinding()]
param(
  [string]$RepoRoot = 'D:\parlys',
  [string]$Tag      = '[EXPERIMENT:refonte-v1]',
  [switch]$DryRun,
  [switch]$Yes
)

$ErrorActionPreference = 'Stop'
Set-Location $RepoRoot

# Files known to have been created wholesale for the refonte.
$WholeFiles = @(
  'src\renderer\hooks\useFocusTrap.ts',
  'src\renderer\utils\api-key-validator.ts',
  'src\renderer\components\Icon.tsx'
) | ForEach-Object { Join-Path $RepoRoot $_ }

# ---------- 1. SCAN ----------
Write-Host "`n[1/5] Scanning for tag '$Tag' ..." -ForegroundColor Cyan

$scanRoots = @('src', 'index.html') |
  ForEach-Object { Join-Path $RepoRoot $_ } |
  Where-Object { Test-Path $_ }

$exts = '*.ts','*.tsx','*.js','*.jsx','*.css','*.scss','*.html'

$files = foreach ($root in $scanRoots) {
  if ((Get-Item $root).PSIsContainer) {
    Get-ChildItem -Path $root -Recurse -File -Include $exts -ErrorAction SilentlyContinue
  } else {
    Get-Item $root
  }
}

$tagLit = [regex]::Escape($Tag)
$hits = $files | Select-String -Pattern $tagLit -SimpleMatch -ErrorAction SilentlyContinue

if (-not $hits) {
  Write-Host "  No matches found. Nothing to revert." -ForegroundColor Yellow
  exit 0
}

$grouped = $hits | Group-Object Path
Write-Host ("  Found {0} match(es) in {1} file(s):" -f $hits.Count, $grouped.Count) -ForegroundColor Green
foreach ($g in $grouped) {
  Write-Host "  -- $($g.Name)" -ForegroundColor White
  $g.Group | ForEach-Object { Write-Host ("       L{0}: {1}" -f $_.LineNumber, $_.Line.Trim()) -ForegroundColor DarkGray }
}

$wholeExisting = $WholeFiles | Where-Object { Test-Path $_ }
if ($wholeExisting) {
  Write-Host "`n  Whole files to delete:" -ForegroundColor White
  $wholeExisting | ForEach-Object { Write-Host "    - $_" -ForegroundColor DarkGray }
}

# ---------- 2. CONFIRM ----------
Write-Host ""
if (-not $Yes) {
  $ans = Read-Host "Proceed with revert? (y/N)"
  if ($ans -notmatch '^(y|yes)$') { Write-Host "Aborted."; exit 0 }
}

# ---------- 3. REVERT ----------
Write-Host "`n[2/5] Reverting ..." -ForegroundColor Cyan

function Show-Diff($path, $before, $after) {
  Write-Host "`n  --- $path" -ForegroundColor Yellow
  $b = $before -split "`n"; $a = $after -split "`n"
  $max = [Math]::Max($b.Count, $a.Count)
  for ($i=0; $i -lt $max; $i++) {
    if ($i -ge $b.Count) { Write-Host ("  + " + $a[$i]) -ForegroundColor Green; continue }
    if ($i -ge $a.Count) { Write-Host ("  - " + $b[$i]) -ForegroundColor Red;   continue }
    if ($b[$i] -ne $a[$i]) {
      Write-Host ("  - " + $b[$i]) -ForegroundColor Red
      Write-Host ("  + " + $a[$i]) -ForegroundColor Green
    }
  }
}

# CSS block:   /* [EXPERIMENT:refonte-v1] ... */ <whitespace> <selector> { ... }
$cssRe = '(?s)/\*\s*' + $tagLit + '.*?\*/\s*[^{}/]+\{[^{}]*\}\s*'
# TS/JS line:  // [EXPERIMENT:refonte-v1] (range=N) -> remove N+1 lines (the comment + N below)
#              // [EXPERIMENT:refonte-v1]          -> remove only the comment line
$lineRe = '^\s*//\s*' + $tagLit + '(?:\s*\(range=(\d+)\))?.*$'

foreach ($g in $grouped) {
  $path     = $g.Name
  $original = Get-Content -LiteralPath $path -Raw -Encoding UTF8
  $work     = $original

  if ($path -match '\.(css|scss)$') {
    $work = [regex]::Replace($work, $cssRe, '')
  } else {
    $lines = $work -split "`r?`n"
    $out   = New-Object System.Collections.Generic.List[string]
    $skip  = 0
    foreach ($ln in $lines) {
      if ($skip -gt 0) { $skip--; continue }
      $m = [regex]::Match($ln, $lineRe)
      if ($m.Success) {
        if ($m.Groups[1].Success) { $skip = [int]$m.Groups[1].Value }
        continue
      }
      $out.Add($ln)
    }
    $work = ($out -join "`r`n")
  }

  if ($work -ne $original) {
    Show-Diff $path $original $work
    if (-not $DryRun) {
      Set-Content -LiteralPath $path -Value $work -Encoding UTF8 -NoNewline
    }
  } else {
    Write-Host "  (no auto-removable block matched in $path -- review manually)" -ForegroundColor Magenta
  }
}

# ---------- 4. DELETE WHOLE FILES ----------
Write-Host "`n[3/5] Deleting whole-refonte files ..." -ForegroundColor Cyan
foreach ($f in $wholeExisting) {
  Write-Host "  removing $f" -ForegroundColor Red
  if (-not $DryRun) { Remove-Item -LiteralPath $f -Force }
}

# ---------- 5. POST-SCAN ----------
Write-Host "`n[4/5] Re-scanning for residual tags ..." -ForegroundColor Cyan
$residual = $files | Where-Object { Test-Path $_.FullName } |
  Select-String -Pattern $tagLit -SimpleMatch -ErrorAction SilentlyContinue
if ($residual) {
  Write-Host "  Residual matches (review manually):" -ForegroundColor Yellow
  $residual | ForEach-Object { Write-Host ("    {0}:{1}" -f $_.Path, $_.LineNumber) -ForegroundColor DarkYellow }
} else {
  Write-Host "  Clean." -ForegroundColor Green
}

# ---------- 6. BUILD ----------
Write-Host "`n[5/5] Running build ..." -ForegroundColor Cyan
if ($DryRun) {
  Write-Host "  (dry-run -- skipping build)" -ForegroundColor DarkGray
  exit 0
}
npm run build
if ($LASTEXITCODE -ne 0) {
  Write-Host "`nBUILD FAILED -- inspect output, fix residual refs, re-run." -ForegroundColor Red
  exit $LASTEXITCODE
}
Write-Host "`nDone. Refonte-v1 reverted and build is green." -ForegroundColor Green
