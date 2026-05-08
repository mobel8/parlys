/**
 * Print the full hover/z-index story for .pill-full / .pill-idle-face
 * from the minified CSS shipped inside the installed app.asar, so we
 * can reason about which face is on top and which actually receives
 * :hover in Electron.
 */
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const asar = require('@electron/asar');

const INSTALLED = path.join(process.env.LOCALAPPDATA, 'Programs', 'VoiceInk', 'resources', 'app.asar');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceink-hover-'));
asar.extractAll(INSTALLED, tmp);
const assetsDir = path.join(tmp, 'dist', 'renderer', 'assets');
const cssName = fs.readdirSync(assetsDir).find((f) => f.endsWith('.css'));
const css = fs.readFileSync(path.join(assetsDir, cssName), 'utf8');

function blocksContaining(substr) {
  const out = [];
  let i = 0;
  while (true) {
    const at = css.indexOf(substr, i);
    if (at < 0) break;
    const start = css.lastIndexOf('}', at) + 1;
    const end   = css.indexOf('}', at) + 1;
    out.push(css.slice(start, end).trim());
    i = end;
  }
  return Array.from(new Set(out));
}

for (const needle of [
  'pill-full',
  'pill-idle-face',
  'is-idle',
  'is-forced-expanded',
]) {
  console.log('\n══ blocks mentioning "' + needle + '" ══');
  for (const b of blocksContaining(needle)) console.log(b);
}

console.log('\n[inspect] tmp kept at', tmp);
