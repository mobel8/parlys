# Lessons

## URL-hash parsers must be defensive against future suffixes

When two pieces of code on opposite sides of a process boundary agree on a URL-hash format (here: `main → loadRenderer()` produces, `index.html` + `useStore.ts` consume), and a NEW segment is added on the producer side without updating the consumers, the equality-based parser silently falls through to its default branch. The bug is invisible in the "no theme" case (default density is `comfortable`, the equality fails and the fallback is `comfortable` → looks correct) and only surfaces in the case the new segment was meant to enable (compact + theme).

**Rules:**
- A multi-segment hash should always be parsed as `head + rest`, never via `if (h === 'X')`. Use `hash.split(';')[0]` (or equivalent) to extract the head, never strip-then-equal.
- When adding a new hash segment on the producer side, search the codebase for every consumer of that hash and verify the parser is segment-aware.
- Comments that promise a behaviour ("the bootstrap stamps CSS vars BEFORE any rule evaluates") MUST be backed by code; if you write the encoding side and skip the decoding side, leave a `// TODO: implement decoder in <file>` next to the encoder, not aspirational prose.

## Pre-paint state must be encoded as RESOLVED data, not as IDs

When the very first frame of a renderer needs to paint with user-specific values (theme, density, locale), encoding only an *identifier* (`themeId=mono`) means the bootstrap has to ALSO carry the lookup table. Encoding the *resolved* values (`palette={...}; effects={...}`) keeps the bootstrap dumb and the source-of-truth table on one side only — same as how density is already a resolved value (`compact` / `comfortable`), not an enum ID requiring a lookup.

## Test the bootstrap with VM, not just typecheck

Inline `<script>` blocks in HTML are invisible to TypeScript. Use Node's `vm.runInContext` against a faked `document` to assert the script behaves correctly under every hash the producer emits — including the malformed-payload safety case. Cheap, deterministic, and catches regressions before any Electron smoke.

## Desktop shortcuts can quietly point at frozen snapshots

When a user reports "0 modifications" after editing source, the first thing to check is **what their shortcut actually launches**. NSIS / installer-built apps land in `%LOCALAPPDATA%\Programs\<App>\<App>.exe` — a snapshot frozen at install time. The desktop .lnk created by the installer keeps targeting that path, so every click reads the snapshot, NEVER the source tree. Always inspect the .lnk via `WScript.Shell.CreateShortcut(path).TargetPath` before assuming the user is "running their code".

## Node 18.20+ `spawn EINVAL` on Windows .cmd shims

Spawning `npx.cmd` (or any `.cmd` shim like `vite.cmd`, `tsc.cmd`) without `shell: true` throws `Error: spawn EINVAL` on Windows since the Node 18.20 / 20.12 child_process security tightening. Two fixes:
1. Pass `shell: true` to spawn (works but loses argv quoting safety).
2. Spawn the underlying executable directly (`node_modules/.bin/<tool>.cmd`) with `shell: true` — keeps the local-vs-global resolution intact.
Always test child-process orchestrators on Windows specifically; Linux/Mac don't hit this code path.

## tsc --watch initial compile fires "fake" rebuild events

`tsc --watch` emits every `.js` output file during its first compile, even when the contents are unchanged from the last run. A naive `fs.watch(distDir)` triggers once per file — dozens of fake "rebuild" events that bounce Electron through a kill+respawn cycle BEFORE the user even sees the first frame. Gate the watcher on tsc's `Watching for file changes.` stdout marker (or equivalent quiescence signal) before reacting to fs events, so only real incremental rebuilds trigger restarts.

## On Windows `child.kill('SIGTERM')` reports as `code=1, signal=null`

POSIX signals don't exist on Windows, so Node's `child_process` translates `kill('SIGTERM')` into `TerminateProcess()`. The `'exit'` event then fires with `(code=1, signal=null)` — looks identical to a real crash. Logic of the form `if (signal !== 'SIGTERM') treatAsCrash()` will misfire on every kill we issue ourselves. Fix: track an `expectingExit` flag that is set TRUE immediately before our own `kill()` call and cleared on the next successful spawn. The exit handler reads the flag instead of trusting the signal field.

## When you wrap a long-running tool in a desktop shortcut, port-collision is double-click

If the wrapper script binds a TCP port (Vite, dev server, IPC), the user double-clicking the desktop shortcut becomes "two instances racing the same port". The second one will crash with a port-bind error and the wrapper batch will pop a `Press any key to close…` console at the user. Add an early `net.connect()` probe to the well-known port and exit cleanly with a friendly log line if it's already bound — don't let the second click ever reach the spawn path.

## Desktop shortcuts: target the GUI binary directly, never .bat via cmd.exe

A `.lnk` whose target is `cmd.exe /c something.bat` will ALWAYS show a console window in the taskbar, even with `WindowStyle = 7` (minimised). The minimised flag affects only how the window is initially shown, it doesn't suppress its existence. For a "professional, no-flash" launch, the shortcut must target a **GUI-subsystem executable** directly. Electron apps qualify: `node_modules\electron\dist\electron.exe` is a GUI binary, double-clicking it never spawns a console. Pattern:
- `TargetPath` -> the GUI exe (electron.exe, or the packaged .exe)
- `Arguments` -> path to the entry .js (in quotes if it contains spaces)
- `WorkingDirectory` -> project root (so `process.cwd()`-relative asset lookups still resolve)

Use `dev.bat`-via-cmd shortcuts ONLY for the dev launcher (HMR + tsc-watch + auto-restart), where the console is the point. Daily-use shortcuts must bypass cmd entirely.

## %APPDATA% / %USERPROFILE% are unset when a script runs under WSL

Helper scripts that write to the app's userData (e.g. injecting an API key into
`voiceink-settings.json`) assume Windows env vars. Under WSL `process.env.APPDATA`
and `USERPROFILE` are **undefined**, so a naive `APPDATA || HOME/AppData/Roaming`
fallback silently writes to a junk Linux path (`/home/<user>/AppData/...`) — the
real Windows file is never touched and the change appears to do nothing. Resolve
the path WSL-aware: prefer `$APPDATA`, else on `win32` use `%USERPROFILE%`, else
(`linux`/WSL) target `/mnt/c/Users/<user>/AppData/Roaming` and **verify the dir
exists** before writing. Always re-read the real file afterwards to confirm the
patch landed (and that pre-existing keys like `groqApiKey` survived).

## Repeated `taskkill /F /IM electron.exe` corrupts the single-instance state

VoiceInk holds `app.requestSingleInstanceLock()` (per userData dir). Force-killing
Electron in a tight test loop doesn't let it release the Windows mutex/lock
cleanly, so the *next* spawn can early-exit with **code=0 and no console output**
(the "lost the lock" branch) — looks exactly like a config crash but is purely
environmental contention. It clears on its own once the killed procs fully die.
Two rules: (1) to prove a config change is innocent, A/B boot the OLD vs NEW
settings in an **isolated `--user-data-dir`** (its own lock — can't collide); both
booting identically = the change is exonerated. (2) `loop-smoke` does NOT taskkill
so it collides with any running instance; `smoke-settings` DOES taskkill (kills the
user's app). For a non-disruptive live-console check, boot isolated and kill only
your own child — never taskkill-all while the user's app is up.
