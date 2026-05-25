/**
 * Diagnostic: extract the INSTALLED app.asar, look at its CSS, and
 * assert that the latest hover/theme fixes are actually there. This
 * answers "is the sync-install script really writing the new code to
 * the installed app, or is something silently failing / caching?".
 *
 * Prints a short PASS/FAIL table to stdout + a tmp path so you can
 * inspect the extracted tree if needed.
 */
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const asar = require('@electron/asar');

const INSTALL_DIR   = path.join(process.env.LOCALAPPDATA, 'Programs', 'VoiceInk');
const INSTALLED_ASAR = path.join(INSTALL_DIR, 'resources', 'app.asar');

if (!fs.existsSync(INSTALLED_ASAR)) {
  console.error('[verify] app.asar not found at', INSTALLED_ASAR);
  process.exit(2);
}
console.log('[verify] asar    :', INSTALLED_ASAR,
  '(', (fs.statSync(INSTALLED_ASAR).size / 1e6).toFixed(2), 'MB)');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceink-verify-'));
asar.extractAll(INSTALLED_ASAR, tmp);
console.log('[verify] extract →', tmp);

// -------- Size breakdown -----------------------------------------------
function size(dir) {
  let s = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    try {
      if (e.isDirectory()) s += size(fp);
      else s += fs.statSync(fp).size;
    } catch {}
  }
  return s;
}
console.log('[verify] inside asar:');
for (const ent of fs.readdirSync(tmp, { withFileTypes: true })) {
  const fp = path.join(tmp, ent.name);
  const s  = ent.isDirectory() ? size(fp) : fs.statSync(fp).size;
  console.log('         ', ent.name.padEnd(20), (s / 1e6).toFixed(2), 'MB');
}

// -------- CSS content check --------------------------------------------
const rendererAssets = path.join(tmp, 'dist', 'renderer', 'assets');
let cssFile = null;
if (fs.existsSync(rendererAssets)) {
  cssFile = fs.readdirSync(rendererAssets).find((f) => f.endsWith('.css'));
}
if (!cssFile) {
  console.error('[verify] no CSS bundle found inside dist/renderer/assets');
  process.exit(3);
}
const css = fs.readFileSync(path.join(rendererAssets, cssFile), 'utf8');
console.log('[verify] css     :', cssFile, (css.length / 1024).toFixed(1), 'KB');

// Vite / lightningCSS minifies in ways that don't preserve author
// source verbatim:
//   • `::before` is rewritten to the CSS2 form `:before`.
//   • `inset: -6px -14px` is expanded into top/right/bottom/left
//     longhands so the shorthand literal never appears in the bundle.
// The regexes below tolerate both the authored and the minified form.
const checks = [
  { name: 'btn-primary uses --on-accent',        re: /\.btn-primary[^}]*color:var\(--on-accent\)/ },
  { name: 'capsule halo ::before present',       re: /\.pill-idle-capsule:{1,2}before\s*\{[^}]*(?:inset:-6px -14px|top:-6px[^}]*left:-14px)/ },
  { name: 'idle uses :has(.pill-idle-capsule',   re: /\.pill-root\.is-idle:has\(\.pill-idle-capsule:hover\)/ },
  { name: 'idle uses :has(.pill-full',           re: /\.pill-root\.is-idle:has\(\.pill-full:hover\)/ },
  { name: 'NO legacy .density-compact:hover',    re: /\.density-compact:hover \.pill-root\.is-idle \.pill\s*\{/, absent: true },
];

console.log('\n  check                                           result');
console.log('  ----------------------------------------------  ------');
let failed = 0;
for (const c of checks) {
  const hit = c.re.test(css);
  const ok  = c.absent ? !hit : hit;
  console.log('  ' + c.name.padEnd(46) + '  ' + (ok ? 'OK' : 'MISSING'));
  if (!ok) failed++;
}

console.log('\n[verify] tmp kept at', tmp, '(delete when done)');
process.exit(failed === 0 ? 0 : 1);
