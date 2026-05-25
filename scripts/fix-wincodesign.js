/**
 * Workaround for electron-builder Windows build failure on non-admin
 * machines: the winCodeSign .7z archive contains macOS dylib symlinks
 * that Windows can only extract with SeCreateSymbolicLinkPrivilege
 * (Developer Mode or Admin). Extract everything EXCEPT those symlinks
 * manually using 7zip's `-x!` exclude flag and place the result in the
 * cache dir where electron-builder expects it.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CACHE_DIR = path.join(os.homedir(), 'AppData', 'Local', 'electron-builder', 'Cache', 'winCodeSign');
const TARGET_DIR = path.join(CACHE_DIR, 'winCodeSign-2.6.0');

if (fs.existsSync(TARGET_DIR)) {
  console.log('winCodeSign-2.6.0 already extracted:', TARGET_DIR);
  process.exit(0);
}

fs.mkdirSync(CACHE_DIR, { recursive: true });

const archive = fs.readdirSync(CACHE_DIR).find((f) => f.endsWith('.7z'));
if (!archive) {
  console.error('No .7z archive found in', CACHE_DIR, '— run `npm run dist:win` once first to trigger the download.');
  process.exit(1);
}

const archivePath = path.join(CACHE_DIR, archive);
const sevenZip = path.join(__dirname, '..', 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
if (!fs.existsSync(sevenZip)) {
  console.error('7za.exe not found at', sevenZip);
  process.exit(1);
}

console.log('Extracting', archivePath, '→', TARGET_DIR);
console.log('(excluding macOS dylib symlinks that Windows can\'t create)');

fs.mkdirSync(TARGET_DIR, { recursive: true });

const args = [
  'x', archivePath,
  '-o' + TARGET_DIR,
  '-y',
  '-x!darwin/10.12/lib/libcrypto.dylib',
  '-x!darwin/10.12/lib/libssl.dylib',
];
const res = spawnSync(sevenZip, args, { stdio: 'inherit' });
if (res.status !== 0) {
  console.error('Extraction failed with code', res.status);
  process.exit(res.status || 2);
}

console.log('winCodeSign extraction OK.');
