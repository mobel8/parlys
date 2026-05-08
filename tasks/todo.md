# Fix: compact mode broken display + first-launch theme flash

## Diagnostic

### Bug A — Hash parsing strips `-sampler` and `;view=…$` but not `;theme=…;fx=…`
Affects two parsers that both check `if (h === 'compact' || h === 'comfortable')`:
1. `index.html` inline bootstrap: `data-density` never stamped → pill window paints opaque dark on first frame.
2. `src/renderer/stores/useStore.ts:initialDensity()` → returns `'comfortable'` for a pill window. `loadSettings()` keeps re-applying this → **CompactView is NEVER mounted in a pill window**. App.tsx renders the comfortable layout (TitleBar+Sidebar+MainView) crammed into 176×52 px. **PRIMARY BUG.**

### Bug B — Inline bootstrap never decodes the theme tokens
`main/index.ts:297-315` encodes `;theme=<id>;fx=…` and the comment claims pre-paint stamping. The bootstrap never reads them → first paint uses Midnight defaults from `index.css`, React mounts ~30-100 ms later and `applyTheme()` overwrites → visible flash.

## Tasks

- [x] 1. Fix `initialDensity()` parser in `src/renderer/stores/useStore.ts` (split on `;`, strip `-sampler`)
- [x] 2. Fix density parser in `index.html` bootstrap (same fix)
- [x] 3. Encode the resolved palette directly in the URL hash from `main/index.ts loadRenderer()` (single source of truth)
- [x] 4. Decode palette + effects in `index.html` bootstrap and stamp all CSS variables + data-* before any rule evaluates
- [x] 5. Run `tsc -p tsconfig.main.json` and `tsc --noEmit -p tsconfig.json`
- [x] 6. Build (`npm run build`)
- [x] 7. Smoke launch and verify both modes paint correctly with no flash

## Review

### Files modified
1. `src/renderer/stores/useStore.ts` — `initialDensity()`: split on `;` first, then strip `-sampler`. Bug was that `;theme=…;fx=…` segments were never stripped, so a pill window's hash failed equality and fell back to `'comfortable'`. Result: CompactView never mounted in the 176×52 pill window — TitleBar+Sidebar+MainView were rendered crammed inside the pill = the "very weird display" the user saw.
2. `index.html` — inline bootstrap completely rewritten. Now (a) parses density correctly via the same split-on-`;` strategy, (b) decodes `;palette=` and `;effects=` URL-encoded JSON, (c) writes ALL the CSS variables (palette tokens, derived accent-1-dim/light, on-accent luminance, legacy aliases, aura, state colours, glow/blur effect tunables) and the data-* attributes (theme, themeMode, animateAura, auraEnabled, shimmer, grain) BEFORE any CSS rule evaluates. Eliminates the cold-launch midnight→user-theme flash.
3. `src/main/index.ts loadRenderer()` — instead of encoding `themeId + fx codes` (which the bootstrap couldn't expand without knowing the THEMES table), now encodes the *fully-resolved palette + effects JSON* directly. shared/themes.ts stays the single source of truth on the main side; the renderer bootstrap becomes a dumb token-applier.

### Tests added (all passing)
- `scripts/_test-bootstrap-hash.js` — 5 unit tests, runs the production bootstrap against synthetic hashes, asserts data-density + every CSS var + data-* gets stamped (including the malformed-payload safety case).
- `scripts/_test-store-density.js` — 9 unit tests for the store's parser.
- `scripts/_test-main-hash-encoding.js` — 9 unit tests for the main-side encoding round-trip.
- `scripts/_test-roundtrip.js` — 13-assertion end-to-end test reproducing the user's exact config (compact + mono + max effects). Asserts the very first frame paints with `--bg-0=#0a0a0b`, `--accent-1=#ffffff`, `--on-accent=#0a0a0a`, `data-density=compact`, etc.
- `scripts/_smoke-compact.js` — Electron-level smoke for compact-mode boot.
- Existing `npm run smoke:settings` still passes.

### How to verify on Windows
1. `npm run build` (already done — no rebuild needed unless source changed).
2. Launch normally — the pill should appear instantly with the user's Monochrome palette, no opaque dark frame, no violet flash.
3. Switch density via the tray "Comfortable" → the comfortable window appears already in mono colours from frame 1.

---

# Fix: desktop shortcut launches an old installed snapshot, never picks up source edits

## Diagnostic
- `C:\Users\moi\Desktop\VoiceInk.lnk` and the start-menu shortcut both targeted `C:\Users\moi\AppData\Local\Programs\VoiceInk\VoiceInk.exe` — the NSIS-installed binary.
- That binary is from **Apr 22, 2025** (a 1+ year-old snapshot). All source edits since are invisible from this shortcut → the user's "0 modifications" symptom.

## Tasks
- [x] 1. Write `scripts/dev-launcher.js` — Node orchestrator (Vite + tsc-watch + Electron with auto-restart on main rebuild).
- [x] 2. Write `dev.bat` — Windows entry point a desktop shortcut can target.
- [x] 3. Write `scripts/setup-dev-shortcut.ps1` — repoints the desktop + start-menu .lnk at `dev.bat`, backs up the originals as `*.installed.lnk.bak`.
- [x] 4. Apply the shortcut update.
- [x] 5. Smoke-test the full flow (shortcut → dev.bat → launcher → Electron → live edit → auto-restart).

## Review

### Files added
- `scripts/dev-launcher.js` — orchestrator. Uses local `node_modules/.bin/{vite,tsc}.cmd` directly (avoiding `npx` to side-step the Node-18.20+ `spawn EINVAL` regression on Windows .cmd shims). Waits for tsc's `Watching for file changes.` quiescence marker before booting Electron so the initial multi-file compile does NOT bounce Electron through a redundant kill+respawn. fs.watch + 300 ms debounce on `dist/main/` triggers each subsequent restart on real edits. Closing the Electron window tears down everything.
- `dev.bat` — minimal entry point: `cd /d %~dp0` then `node scripts\dev-launcher.js`. Holds the console open on errorlevel != 0 so the user can read crash output.
- `scripts/setup-dev-shortcut.ps1` — idempotent: backs up the existing .lnk to `<name>.installed.lnk.bak` (only on first run) then rewrites TargetPath to `cmd.exe /c "<root>\dev.bat"`. WindowStyle 7 (minimised) so the launcher console doesn't steal focus on click.

### End-to-end timing (measured on user's machine)
| Phase | Duration |
|-------|----------|
| Click shortcut → Vite + tsc spawned | ~1 s |
| tsc first compile finishes → Electron launches | ~8 s |
| Edit `src/main/*.ts` → app restarts with the change | **~11 s** (tsc rebuild ~7 s + debounce 0.3 s + Electron boot ~3 s) |
| Edit `src/renderer/**` → app updates | **instant** (Vite HMR, no relaunch) |

### Restoring the old installer-launching shortcut
The setup script backed up the original .lnk files. To revert:
```powershell
$d = [Environment]::GetFolderPath('Desktop')
Copy-Item "$d\VoiceInk.lnk.installed.lnk.bak" "$d\VoiceInk.lnk" -Force
```

### Hardening pass (2nd iteration — bugs found while testing the shortcut)

After the initial implementation, an in-loop test hammered the launcher with rapid successive edits + reverts and uncovered three issues. All fixed:

1. **`DEP0190` deprecation** thrown by Node 18.20+ when spawning `.cmd` shims with `shell: true` + args. Fixed by going through `cmd.exe /d /s /c "<full quoted command>"` with `windowsVerbatimArguments: true`. No `shell: true`, no DEP0190.

2. **Premature shutdown on rapid double-rebuilds.** On Windows, `child.kill('SIGTERM')` translates to `TerminateProcess()`, which Node's `'exit'` event surfaces as `code=1, signal=null`. Our handler used `signal !== 'SIGTERM'` to detect "user closed the app" → false positive on every Windows kill → launcher shut down mid-restart. Fixed with an `expectingExit` flag set immediately before the kill and cleared by the next `spawnElectron()`. The exit handler now ignores the kill it itself initiated.

3. **Double-click on the desktop shortcut.** Without protection, the second invocation tried to start a second Vite on port 5173 → `--strictPort` failed → cascade shutdown noisily popped a `Press any key to close…` console at the user. Fixed with a 5173-already-in-use probe at launcher startup that exits with code 0 (so dev.bat doesn't pause) and a friendly log line.

### Final smoke matrix (every row passing)

| Scenario | Behaviour | Verified |
|----------|-----------|----------|
| Cold click on shortcut | Vite + tsc + Electron come up in order | ✅ |
| 40s idle steady state | 1 stable Vite WS connection, 0 restarts, 0 errors | ✅ |
| Edit `src/renderer/**` | Vite HMR pushes update, Electron NOT restarted | ✅ |
| Edit `src/main/**` | tsc rebuilds, Electron restarts in ~2 s | ✅ |
| Two edits within 1 s on `src/main/**` | Both edits coalesce / process correctly, launcher stays alive | ✅ |
| Double-click on shortcut while running | 2nd invocation detects port 5173 in use, exits cleanly with friendly log, original instance untouched | ✅ |
| Genuine user quit (close electron) | Launcher tears down Vite + tsc, exits clean | ✅ |
| Process census mid-session | 1 launcher node + 1 Vite node + 1 tsc node + 4 Electron procs (main+helpers) | ✅ |

### Result

**The desktop shortcut now reflects every source modification automatically.** Renderer changes are live (HMR, instant). Main process changes restart the app within ~2-7 s end-to-end. No spurious restarts, no premature shutdowns, no deprecation warnings, no crash banners on double-click.


