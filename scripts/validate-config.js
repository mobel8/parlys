#!/usr/bin/env node
/**
 * Quick sanity check of package.json's electron-builder config.
 * Does NOT run electron-builder itself — just verifies the JSON
 * is well-formed and references hooks / icons that actually exist.
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pkg  = require(path.join(ROOT, 'package.json'));

const errors = [];
const warns  = [];

function mustExist(rel, label) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) errors.push(`${label}: "${rel}" does not exist`);
}

console.log('productName :', pkg.build.productName);
console.log('appId       :', pkg.build.appId);
console.log('version     :', pkg.version);

// Targets per platform.
for (const os of ['win', 'mac', 'linux']) {
  const ts = (pkg.build[os] && pkg.build[os].target) || [];
  console.log(`${os.padEnd(11)} :`, ts.map(t => `${t.target}(${(t.arch||[]).join('+')})`).join(' '));
}

// Icons.
mustExist(pkg.build.win.icon,   'win.icon');
mustExist(pkg.build.mac.icon,   'mac.icon');
mustExist(pkg.build.linux.icon, 'linux.icon');

// Linux hooks.
if (pkg.build.deb && pkg.build.deb.afterInstall)
  mustExist(pkg.build.deb.afterInstall, 'deb.afterInstall');
if (pkg.build.deb && pkg.build.deb.afterRemove)
  mustExist(pkg.build.deb.afterRemove, 'deb.afterRemove');
if (pkg.build.rpm && pkg.build.rpm.afterInstall)
  mustExist(pkg.build.rpm.afterInstall, 'rpm.afterInstall');
if (pkg.build.rpm && pkg.build.rpm.afterRemove)
  mustExist(pkg.build.rpm.afterRemove, 'rpm.afterRemove');

// NSIS shortcut keys.
const nsis = pkg.build.nsis || {};
if (nsis.createDesktopShortcut !== 'always')
  warns.push('nsis.createDesktopShortcut is not "always"');
if (!nsis.createStartMenuShortcut)
  warns.push('nsis.createStartMenuShortcut is false');

// Linux deb/rpm Icon reference.
if (pkg.build.linux && pkg.build.linux.desktop && !pkg.build.linux.desktop.Name)
  warns.push('linux.desktop.Name is missing');

console.log('');
if (warns.length) {
  console.log('Warnings:');
  warns.forEach(w => console.log('  - ' + w));
}
if (errors.length) {
  console.log('');
  console.log('Errors:');
  errors.forEach(e => console.log('  - ' + e));
  console.log('');
  console.error('[validate-config] FAILED');
  process.exit(1);
}

console.log('');
console.log('[validate-config] OK — package.json build config looks good.');
