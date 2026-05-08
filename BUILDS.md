# VoiceInk — Installers

## What you get

| Platform | Artifact                                          | Desktop shortcut |
|----------|---------------------------------------------------|------------------|
| Windows  | `VoiceInk-Setup-<version>-x64.exe` (NSIS)         | ✅ Automatic (Desktop + Start Menu) |
| Linux    | `VoiceInk-<version>-x86_64.AppImage` (portable)   | Via AppImageLauncher (optional) or `chmod +x && ./VoiceInk.AppImage --appimage-extract` |
| Linux    | `voiceink_<version>_amd64.deb` (Debian / Ubuntu)  | ✅ Automatic — a **VoiceInk.desktop** icon is dropped on every user's Desktop **and** registered in the application menu |
| Linux    | `voiceink-<version>.x86_64.rpm` (Fedora / RHEL)   | ✅ Automatic — same mechanism as the .deb |
| Linux    | `voiceink-<version>-linux-x64.tar.gz` (portable)  | Manual (unpack anywhere, run `./voiceink`) |
| macOS    | `VoiceInk-<version>-mac-(x64\|arm64).dmg`         | Drag `VoiceInk.app` into **Applications** — the icon appears automatically in Launchpad and Spotlight |
| macOS    | `VoiceInk-<version>-mac-(x64\|arm64).zip`         | Same as DMG, but unpacks faster without mounting a volume |

All installers produce a **shortcut/launcher** that looks and behaves like a native application (icon, menu entry, taskbar integration).

## Local one-shot build

From any host, the easiest path is:

- **Windows:** double-click `build-all.bat`
- **Linux / macOS:** `./build-all.sh`

Both scripts:
1. `npm ci` if `node_modules/` is missing
2. regenerate platform icons from `assets/icon.svg`
3. build `dist/` (TypeScript + Vite)
4. invoke `electron-builder` for the current OS **and** all cross-builds that are known to work from this host
5. run `scripts/verify-artifacts.js` to confirm every expected file is present and is structurally valid (PE header for `.exe`, ELF header for `.AppImage`, dpkg metadata for `.deb`, `hdiutil imageinfo` for `.dmg`…)

## Continuous build + test loop

`scripts/build-loop.js` repeats the whole pipeline N times and — on Windows only — sync-installs the fresh build and runs the installed-hover regression test (`scripts/run-installed-hover-test.js`) on each pass:

```bash
# 3 full build + verify + hover-test passes (~4–10 min / pass)
node scripts/build-loop.js --runs=3

# skip the installed-hover step
node scripts/build-loop.js --runs=3 --no-hover

# native target only, no cross-builds
node scripts/build-loop.js --runs=1 --native
```

## Platform-specific details

### Windows (native on Windows)

```powershell
npm ci
npm run dist:win
# → release\VoiceInk-Setup-1.0.0-x64.exe
```

> First build fails if Developer Mode is **off** — electron-builder needs to extract macOS symlinks from its tool archive. Either enable Developer Mode (Settings → Update & Security → For developers), or run the project's pre-extraction helper once.

### Linux (native on Linux)

```bash
sudo apt-get install -y ruby ruby-dev rubygems build-essential rpm
sudo gem install --no-document fpm
npm ci
npm run dist:linux
# → release/VoiceInk-1.0.0-x86_64.AppImage
# → release/voiceink_1.0.0_amd64.deb
# → release/voiceink-1.0.0.x86_64.rpm
# → release/voiceink-1.0.0-linux-x64.tar.gz
```

**Desktop shortcut behaviour:** the `.deb` and `.rpm` packages run `build/linux-after-install.sh` during installation, which:
- registers the app menu entry via `/usr/share/applications/voiceink.desktop`
- drops a `VoiceInk.desktop` launcher on **every existing user's Desktop** (respecting XDG `user-dirs.dirs`, falling back to `~/Desktop` or `~/Bureau`)
- marks the launcher as a trusted GNOME `.desktop` file so it shows its icon immediately
- refreshes the icon cache with `update-desktop-database` and `gtk-update-icon-cache`

Removal runs `build/linux-after-remove.sh`, which cleans up every per-user Desktop shortcut it previously placed.

### macOS (native on macOS)

```bash
npm ci
npm run dist:mac
# → release/VoiceInk-1.0.0-mac-x64.dmg
# → release/VoiceInk-1.0.0-mac-arm64.dmg
# → release/VoiceInk-1.0.0-mac-x64.zip
# → release/VoiceInk-1.0.0-mac-arm64.zip
```

The DMG opens on a 540×380 window with a left-hand app icon and a right-hand `/Applications` symlink — the canonical macOS "drag to install" layout. No extra post-install script: macOS picks up the icon, adds it to Launchpad, and indexes it in Spotlight automatically.

## Cross-platform build — GitHub Actions

The repo ships `.github/release-workflow.yml.example`, a workflow that builds **all three platforms** on native runners and uploads the artifacts. Triggers once activated:

1. **Tag push** — `git tag v1.0.0 && git push --tags` → a GitHub Release is created with every installer attached.
2. **Manual dispatch** — Actions tab → *Build installers* → *Run workflow*. Artifacts are kept for 30 days under that run.

Each runner installs only the tools it needs (`fpm` on Linux, Xcode toolchain on macOS, nothing extra on Windows) and calls `electron-builder` with the matching `--win` / `--linux` / `--mac` flag.

### Activating the workflow (one-off)

A Personal Access Token without the `workflow` scope can't push files under `.github/workflows/`, so activate the workflow from GitHub's web UI:

1. On GitHub, open `.github/release-workflow.yml.example`.
2. Click ✏️ *Edit*, rename the file to `.github/workflows/release.yml`.
3. Commit directly to `main`.

Alternatively push with a PAT that has the `workflow` scope, or use `gh workflow create`.

## Why some cross-builds aren't possible locally

| Target | Windows host | Linux host | macOS host |
|--------|:------------:|:----------:|:----------:|
| `.exe` (NSIS)       | ✅ native | via `wine` | via `wine` |
| `.AppImage`         | cross-build if Dev Mode on | ✅ native | ✅ native |
| `.tar.gz` (portable) | cross-build | ✅ native | ✅ native |
| `.deb` / `.rpm`      | ❌ (needs `fpm`) | ✅ native | via `fpm` |
| `.dmg` / `.zip`      | ❌ (needs `hdiutil`) | ❌ | ✅ native |

GitHub Actions sidesteps all of the gaps by running each platform's build on that platform's own runner.

## Code signing (optional)

Out of the box the Windows and macOS binaries are **unsigned**:

- **Windows** — the first launch shows a "Windows protected your PC" SmartScreen dialog. Click *More info* → *Run anyway*. To silence it permanently, purchase a code-signing certificate and set `CSC_LINK` + `CSC_KEY_PASSWORD` in the build env.
- **macOS** — Gatekeeper will block the app. Right-click → *Open* once, or run `xattr -cr /Applications/VoiceInk.app`. For a permanent fix you need an Apple Developer ID and an app-specific password set via `CSC_LINK` / `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD`.

## Uninstall

- **Windows** — *Settings → Apps* → VoiceInk → Uninstall. User settings (in `%APPDATA%\voiceink`) are preserved unless you tick *Delete user data*.
- **Linux (.deb)** — `sudo apt remove voiceink` (also removes the Desktop shortcut).
- **Linux (.rpm)** — `sudo dnf remove voiceink` or `sudo rpm -e voiceink`.
- **Linux (AppImage)** — delete the file; AppImageLauncher removes its registration automatically.
- **macOS** — drag `VoiceInk.app` out of Applications. Settings live in `~/Library/Application Support/voiceink`.
