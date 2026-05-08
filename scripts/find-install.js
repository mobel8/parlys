/**
 * Locates the installed VoiceInk.exe on this Windows box and prints its
 * folder to stdout. Looks at: %LOCALAPPDATA%\Programs\VoiceInk,
 * %ProgramFiles%\VoiceInk, %ProgramFiles(x86)%\VoiceInk, and the
 * "Uninstall" registry keys as a fallback. Exits 0 with the path on
 * stdout; exits 2 + an error message on stderr when nothing is found.
 */
const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CANDIDATES = [
  process.env.LOCALAPPDATA   && path.join(process.env.LOCALAPPDATA,   'Programs', 'VoiceInk'),
  process.env.ProgramFiles   && path.join(process.env.ProgramFiles,   'VoiceInk'),
  process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'VoiceInk'),
].filter(Boolean);

console.log('[find-install] candidates:');
for (const c of CANDIDATES) console.log('  - ' + c + '  exists=' + fs.existsSync(path.join(c, 'VoiceInk.exe')));

for (const dir of CANDIDATES) {
  const exe = path.join(dir, 'VoiceInk.exe');
  if (fs.existsSync(exe)) {
    console.log('FOUND: ' + dir);
    process.exit(0);
  }
}

// Fallback: scan all 3 Uninstall roots for an entry named VoiceInk.
const ROOTS = [
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
];
for (const root of ROOTS) {
  let out = '';
  try { out = execSync(`reg query "${root}" /s /f "VoiceInk" 2>nul`).toString(); } catch {}
  const m = out.match(/InstallLocation\s+REG_SZ\s+(.+)/i);
  if (m) {
    const dir = m[1].trim();
    if (fs.existsSync(path.join(dir, 'VoiceInk.exe'))) {
      process.stdout.write(dir);
      process.exit(0);
    }
  }
}

process.stderr.write(
  'VoiceInk.exe not found. Searched:\n' +
    CANDIDATES.map((c) => '  - ' + c).join('\n') +
    '\nand the Uninstall registry keys.\n'
);
process.exit(2);
