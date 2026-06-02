/**
 * Check whether the installed app.asar's main/index.js handles the
 * PARLYS_CDP env var. If not, we need to re-sync after rebuilding
 * the main side.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const asar = require('@electron/asar');

const INSTALLED = path.join(process.env.LOCALAPPDATA, 'Programs', 'Parlys', 'resources', 'app.asar');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parlys-main-'));
asar.extractAll(INSTALLED, tmp);

const mainJs = path.join(tmp, 'dist', 'main', 'index.js');
const s = fs.readFileSync(mainJs, 'utf8');
console.log('main/index.js size:', s.length, 'bytes');
for (const needle of ['PARLYS_CDP', 'inspect=9222', '9222', 'remote-debugging-port', 'setName', 'parlys']) {
  const idx = s.indexOf(needle);
  console.log('  "' + needle + '"  →  ' + (idx >= 0 ? 'present @' + idx : 'MISSING'));
}
console.log('\n[inspect] tmp:', tmp);
