/**
 * Generate platform icons from assets/icon.svg.
 *
 *  - assets/icon.png  (1024×1024, Linux + fallback for Linux AppImage)
 *  - assets/icon.ico  (multi-resolution 16,24,32,48,64,128,256 — Windows)
 *  - assets/icons/*.png  (512, 256, 128, 64, 48, 32, 16 — for Linux .deb)
 *
 * .icns for macOS is skipped (electron-builder regenerates it from the
 * PNG on build). Run `npm run gen:icons` to refresh.
 */
const fs   = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIcoMod = require('png-to-ico');
const pngToIco = typeof pngToIcoMod === 'function' ? pngToIcoMod : pngToIcoMod.default;

const ASSETS = path.join(__dirname, '..', 'assets');
const SVG    = path.join(ASSETS, 'icon.svg');
const OUT_PNG = path.join(ASSETS, 'icon.png');
const OUT_ICO = path.join(ASSETS, 'icon.ico');
const LINUX_DIR = path.join(ASSETS, 'icons');

if (!fs.existsSync(SVG)) {
  console.error('Missing', SVG);
  process.exit(2);
}

const svgBuf = fs.readFileSync(SVG);

async function renderPng(size, outPath) {
  await sharp(svgBuf, { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  console.log('  written', outPath, `(${size}×${size})`);
}

async function main() {
  // 1. Linux master icon + fallback PNG at 1024 for electron-builder.
  console.log('→ master PNG');
  await renderPng(1024, OUT_PNG);

  // 2. Linux icon set.
  console.log('→ Linux icon set');
  fs.mkdirSync(LINUX_DIR, { recursive: true });
  for (const s of [512, 256, 128, 64, 48, 32, 16]) {
    await renderPng(s, path.join(LINUX_DIR, `${s}x${s}.png`));
  }

  // 3. Windows ICO — multi-resolution.
  console.log('→ Windows ICO');
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const buffers = [];
  for (const s of icoSizes) {
    const tmp = path.join(ASSETS, `_tmp_ico_${s}.png`);
    await renderPng(s, tmp);
    buffers.push(fs.readFileSync(tmp));
    fs.unlinkSync(tmp);
  }
  const ico = await pngToIco(buffers);
  fs.writeFileSync(OUT_ICO, ico);
  console.log('  written', OUT_ICO, `(${icoSizes.length} sizes)`);

  console.log('\nicons generated successfully.');
}

main().catch((e) => { console.error(e); process.exit(1); });
