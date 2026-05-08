# Code Signing — Windows & macOS

This document walks through the procurement and wiring of the certificates
VoiceInk needs to ship **without** SmartScreen / Gatekeeper warnings and to
enable the auto-updater to verify binaries at install time.

Without signing, two things break:

1. **Windows users** see a red "Unknown publisher" SmartScreen modal the
   first time they run the NSIS installer — empirical abandonment rate
   is **40-60 %** of the funnel.
2. **macOS users** can't open the app at all past Big Sur unless the
   binary is signed **and** notarized. `electron-updater` specifically
   refuses to install unsigned updates on macOS.

---

## 1. Windows — EV Code Signing Certificate

### 1.1 Why EV (not OV)

| Type | SmartScreen warning | Price (2026) | Delivery |
|------|---------------------|--------------|----------|
| **OV** (Organization Validated) | Shown for ~3000 installs or ~3 months, then builds reputation | ~160-200 €/an | 1-3 business days, software token |
| **EV** (Extended Validation) | **Zero warning from day one** — Microsoft auto-trusts EV-signed binaries | ~350-450 €/an | 1-2 weeks, HARDWARE token (USB) |

**Recommendation: EV.** The one-time USB token hassle pays off in conversion
rate from the first install. A single prevented abandonment at 10 €/month
LTV covers the yearly certificate cost.

### 1.2 Recommended providers (ranked by price × trust)

1. **Certum** (Asseco) — ~350 €/an for EV, well-documented for Node/Electron,
   Polish CA but fully trusted by Microsoft. https://shop.certum.eu/
2. **SSL.com** — ~500 $/an but faster validation (sometimes < 5 days) and
   supports remote signing via their **eSigner** cloud HSM (no USB needed).
   https://www.ssl.com/certificates/ev-code-signing/
3. **Sectigo / DigiCert** — industry standard but pricier (~700-800 $/an).

### 1.3 Validation requirements

- Legal business entity (SASU / SARL / EURL / LTD / Inc. — not personal name).
  If you're currently EI, **create your SASU first** (LegalStart ~250 €,
  2-3 days). The CA will request a KBIS extract less than 3 months old.
- Phone verification from a listed business number (D-U-N-S, Le Figaro
  Directory, or the CA's own lookup).
- Government-issued ID of the signing authority.

### 1.4 Wiring in electron-builder

Once the USB token arrives (Certum), install the **proCertum CardManager**
and **proCertum CryptoAgent** drivers, then insert the token. Windows
Certificate Manager (`certmgr.msc`) should now list the cert.

Add to your **local** machine's environment (never commit these):

```bat
REM ~/.voiceink-signing.cmd  (NOT in git)
set CSC_LINK=
set CSC_KEY_PASSWORD=
set WIN_CSC_LINK=
set WIN_CSC_KEY_PASSWORD=
REM For hardware-token signing, use signtool directly rather than a PFX:
set VOICEINK_SIGNTOOL_PATH=C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe
set VOICEINK_TOKEN_THUMBPRINT=<your cert SHA-1 thumbprint, lowercase no spaces>
```

Then patch `scripts/_run-dist-win.js` to post-sign with signtool after
electron-builder emits the `.exe`:

```js
// After electron-builder completes
const { execFileSync } = require('child_process');
const signtool = process.env.VOICEINK_SIGNTOOL_PATH;
const thumb = process.env.VOICEINK_TOKEN_THUMBPRINT;
if (signtool && thumb) {
  const exe = `release/VoiceInk-Setup-${version}-x64.exe`;
  execFileSync(signtool, [
    'sign', '/fd', 'SHA256',
    '/tr', 'http://time.certum.pl',   // RFC-3161 timestamp server
    '/td', 'SHA256',
    '/sha1', thumb,
    exe,
  ], { stdio: 'inherit' });
}
```

The timestamp server is critical — without `/tr`, the signature expires the
day your cert expires. With a timestamp, installers signed today remain
valid forever, even after the cert rotates.

### 1.5 Verification

After the build, right-click the `.exe` → Properties → Digital Signatures.
You should see:

- Name: your company name
- Digest: SHA-256
- Timestamp: valid, server time.certum.pl

Upload the EXE to https://www.virustotal.com — a signed binary typically
gets 0/70 detections; an unsigned one can get 3-8 false positives.

---

## 2. macOS — Developer ID + Notarization

### 2.1 Apple Developer Program enrollment

- Cost: **99 $/year** (individual) or 99 $ + D-U-N-S (company)
- URL: https://developer.apple.com/programs/enroll/
- Timeline: individuals ~24h, companies 1-2 weeks (D-U-N-S verification)

Once enrolled, generate in **Xcode → Settings → Accounts → Manage Certificates**:

- **Developer ID Application** (used to sign the .app bundle)
- **Developer ID Installer** (used to sign the .pkg, optional for DMG-only)

Export both as `.p12` files with a strong password.

### 2.2 Environment variables (macOS build machine or CI)

```bash
# ~/.voiceink-signing.sh  (NOT in git)
export CSC_LINK="/Users/you/Certificates/DeveloperID.p12"
export CSC_KEY_PASSWORD="..."
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop"  # App-specific password, NOT your Apple ID password
export APPLE_TEAM_ID="ABCD123456"  # From developer.apple.com/account → Membership
```

Generate an app-specific password at https://appleid.apple.com → Sign-in &
Security → App-Specific Passwords.

### 2.3 electron-builder config (already partially set)

Update `package.json` `build.mac` :

```json
"mac": {
  "hardenedRuntime": true,
  "gatekeeperAssess": false,
  "entitlements": "build/entitlements.mac.plist",
  "entitlementsInherit": "build/entitlements.mac.plist",
  "notarize": {
    "teamId": "ABCD123456"
  }
}
```

Create `build/entitlements.mac.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.device.audio-input</key>
  <true/>
  <key>com.apple.security.device.microphone</key>
  <true/>
  <key>com.apple.security.network.client</key>
  <true/>
</dict>
</plist>
```

### 2.4 Verification

After `npm run dist:mac`:

```bash
# Is the .app signed?
codesign -dv --verbose=4 release/mac-arm64/VoiceInk.app
# Expected: "Authority=Developer ID Application: <Your Name> (<Team ID>)"

# Is notarization stapled?
xcrun stapler validate release/VoiceInk-1.7.0-mac-arm64.dmg
# Expected: "The validate action worked!"

# Does Gatekeeper accept it on a fresh Mac?
spctl --assess --type execute --verbose release/mac-arm64/VoiceInk.app
# Expected: "accepted" + "source=Notarized Developer ID"
```

---

## 3. Linux — Not required, but recommended

Linux packages don't have system-wide signature enforcement, but:

- AppImages benefit from **detached GPG signatures** for users on
  appimagepool / appimagehub.
- `.deb` / `.rpm` can be signed with `dpkg-sig` / `rpmsign` and published
  to an APT/YUM repo for `apt update`-style installation. This is not
  strictly needed for VoiceInk's initial launch — shipping raw `.deb` +
  `.AppImage` from GitHub Releases is the pragmatic path.

---

## 4. GitHub Releases workflow (auto-updater feed)

`electron-builder` emits these files at `npm run dist:win`:

```
release/
  VoiceInk-Setup-1.7.0-x64.exe          ← installer (signed)
  VoiceInk-Setup-1.7.0-x64.exe.blockmap ← differential update metadata
  latest.yml                             ← the feed electron-updater reads
```

`latest.yml` contains the version, SHA-512 of the EXE, and URL hint. The
auto-updater fetches `https://github.com/mobel8/voiceink/releases/download/v1.7.0/latest.yml`
at startup.

### 4.1 Publishing steps

**Option A — Manual (recommended for solo launch):**

1. `npm run dist:win`
2. Create a GitHub Release at https://github.com/mobel8/voiceink/releases/new
   with tag `v1.7.0`
3. Upload ALL files from `release/` **except** the `win-unpacked/` folder,
   `builder-debug.yml`, and `builder-effective-config.yaml`. The critical
   ones for auto-update are `latest.yml`, `*.exe`, `*.exe.blockmap`.
4. Publish the release.

**Option B — Automated (for CI):**

Set `GH_TOKEN` to a GitHub PAT with `repo` scope. `electron-builder` will
upload the artifacts automatically because `build.publish[0].provider` is
set to `github` in `package.json`.

```bat
set GH_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
npm run dist:win
REM electron-builder now uploads to a draft release at tag v1.7.0
REM → manually promote the draft to 'published' on GitHub UI
```

### 4.2 Verifying the feed

Once published:

```bat
curl -sL https://github.com/mobel8/voiceink/releases/latest/download/latest.yml
```

Expected output:

```yaml
version: 1.7.0
files:
  - url: VoiceInk-Setup-1.7.0-x64.exe
    sha512: <base64>
    size: 87837569
path: VoiceInk-Setup-1.7.0-x64.exe
sha512: <base64>
releaseDate: '2026-04-22T07:00:00.000Z'
```

---

## 5. Rollback strategy

If a release ships a crash bug:

1. **Delete** the GitHub Release (not just unpublish — delete). The tag
   can stay; `electron-updater` only reads the latest published release
   via `releases/latest/download/latest.yml`.
2. The previous release (`v1.6.0`) becomes the "latest" again.
3. Users who already updated to the bad version can manually download
   `v1.6.0` from the releases page (their auto-updater won't roll back
   automatically — that's by design, preventing downgrade attacks).
4. Ship a `v1.7.1` patch within 24-48 h with a fix — users who held off
   the manual rollback will auto-update straight from 1.7.0 → 1.7.1.

---

## 6. Renewal calendar

Put these in your calendar with a **60-day advance reminder**:

- Windows EV cert: every year from purchase date.
- Apple Developer Program: every year, auto-renewed via Apple ID, but
  verify the membership a month before expiry.
- EV cert renewal MUST be done before expiry — Microsoft SmartScreen
  reputation does NOT transfer to a cert that was mid-lapse.
