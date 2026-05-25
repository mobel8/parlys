/**
 * Dumps every CSS rule that mentions "pill-idle-capsule" from the
 * installed asar's rendered bundle, so we can see exactly what Vite
 * produced and why the ::before halo regex fails.
 */
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const asar = require('@electron/asar');

const INSTALL_DIR  = path.join(process.env.LOCALAPPDATA, 'Programs', 'VoiceInk');
const INSTALLED   = path.join(INSTALL_DIR, 'resources', 'app.asar');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceink-inspect-'));
asar.extractAll(INSTALLED, tmp);

const assetsDir = path.join(tmp, 'dist', 'renderer', 'assets');
const cssName   = fs.readdirSync(assetsDir).find((f) => f.endsWith('.css'));
const css       = fs.readFileSync(path.join(assetsDir, cssName), 'utf8');

console.log('css file :', cssName, '(', css.length, 'bytes )');
console.log('mentions of "pill-idle-capsule" :');

// Walk the CSS grabbing each selector-block that contains the string.
let i = 0;
const results = [];
while (true) {
  const at = css.indexOf('pill-idle-capsule', i);
  if (at < 0) break;
  const start = css.lastIndexOf('}', at) + 1;
  const end   = css.indexOf('}', at) + 1;
  results.push(css.slice(start, end));
  i = end;
}
// De-duplicate
const seen = new Set();
for (const block of results) {
  if (seen.has(block)) continue;
  seen.add(block);
  console.log('---');
  console.log(block.trim());
}

console.log('\n[inspect] tmp kept at', tmp);
