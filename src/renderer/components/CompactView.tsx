import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Loader2, AlertCircle, Check, Maximize2 } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { blobToBase64 } from '../lib/blob';

/**
 * Compact pill widget — Superwhisper-style floating badge.
 *
 * The window is 176x52, transparent, frameless, always-on-top, skipTaskbar.
 * The whole pill body is a drag handle (`-webkit-app-region: drag`); only
 * the mic button and expand icon are `no-drag` so they can receive clicks.
 *
 * Right-click anywhere on the pill opens a native context menu (agrandir,
 * paramètres, masquer, quitter) via IPC.
 *
 * Visual states:
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │ idle + not hovered  → very small black oval (Superwhisper-style)│
 *   │ idle + hovered      → full pill, violet accent, "Parler"        │
 *   │ recording           → full pill, red glow, live mini waveform   │
 *   │ processing          → full pill, cyan glow, "Transcription…"    │
 *   │ done (brief flash)  → full pill, green "Injecté"                │
 *   │ error               → full pill, amber warning + message        │
 *   └─────────────────────────────────────────────────────────────────┘
 *
 * The pill expands/collapses smoothly via CSS transitions on its width,
 * height, padding, background and shadow (see `.pill` / `.pill-root.is-*`
 * in `index.css`). React just toggles the two top-level classes and swaps
 * the inner face via opacity.
 */
export function CompactView() {
  const {
    settings,
    recState, setRecState,
    lastTranscript, setLastTranscript,
    lastLatencyMs, setLastLatencyMs,
    lastError, setLastError,
    audioLevel, setAudioLevel,
    loadHistory,
  } = useStore();

  const [justDone, setJustDone] = useState(false);

  // Speculative transcription bookkeeping: id of the last speculative
  // request actually DISPATCHED to main (the recorder may report a spec id
  // whose IPC we haven't finished sending — commit would miss, we fall back).
  const dispatchedSpecRef = useRef<string | null>(null);

  // BENIGN errors ("no speech detected", clip too short/inaudible) are
  // transient information, not actionable failures — they auto-clear back
  // to the normal idle state after 3 s (which also lets the interaction
  // floor shrink the pill back). HARD errors (API key, network…) stay
  // until the user acts, because hiding them would mask a real problem.
  const BENIGN_ERROR = /aucune parole|trop court|silencieux|inaudible/i;
  const benignErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearBenignTimer = () => {
    if (benignErrorTimer.current) { clearTimeout(benignErrorTimer.current); benignErrorTimer.current = null; }
  };
  const showError = (msg: string) => {
    clearBenignTimer();
    setLastError(msg);
    setRecState('error');
    if (BENIGN_ERROR.test(msg)) {
      benignErrorTimer.current = setTimeout(() => {
        benignErrorTimer.current = null;
        // Only clear if we're STILL showing that transient error — a new
        // recording/processing state must never be yanked back to idle.
        if (recStateRef.current === 'error') {
          setLastError('');
          setRecState('idle');
        }
      }, 3000);
    }
  };
  useEffect(() => () => clearBenignTimer(), []);

  const recorder = useAudioRecorder({
    onLevel: (rms) => setAudioLevel(rms),
    speculative: settings.speculativeStt !== false,
    // Mid-capture end-of-utterance: run the WHOLE pipeline now, park the
    // result in main (zero side effects). By the time the user presses
    // stop, the Whisper round-trip already happened inside their natural
    // pause → the commit in onStop pastes near-instantly.
    onSpeculativeReady: async (blob, mimeType, _audioMs, stats, specId) => {
      try {
        const audioBase64 = await blobToBase64(blob);
        dispatchedSpecRef.current = specId;
        void window.parlys.transcribe({
          audioBase64,
          mimeType,
          language: settings.language === 'auto' ? undefined : settings.language,
          translateTo: settings.translateTo || undefined,
          mode: settings.mode,
          audioMs: stats.totalMs,
          speechMs: stats.speechMs,
          speech: stats.speechMeta ?? undefined,
          speculative: true,
          specId,
        }).catch(() => { /* commit falls back to classic */ });
      } catch { /* base64 failed — classic path at stop */ }
    },
    onStop: async (blob, mimeType, audioMs, stats) => {
      setRecState('processing');
      setAudioLevel(0);
      const t0 = Date.now();
      const finish = async (res: import('../../shared/types').TranscribeResponse) => {
        setLastLatencyMs(Date.now() - t0);
        if (!res.ok) {
          showError(res.error || 'Erreur inconnue');
          return;
        }
        // Empty / inaudible recording — don't flash "Injecté" as if it worked.
        if (res.empty || !res.finalText) {
          showError('Aucune parole détectée');
          return;
        }
        // Main already injected directly (no renderer round-trip) — only
        // paste here if it didn't (res.injected false, e.g. native path
        // unavailable). Avoids a double paste.
        if (settings.autoInject && res.finalText && !res.injected) {
          await window.parlys.injectText(res.finalText);
        }
        setLastTranscript(res.finalText);
        setRecState('idle');
        setLastError('');
        // Flash "done" state briefly before returning to idle label.
        setJustDone(true);
        setTimeout(() => setJustDone(false), 1500);
        // History refresh last — lowest priority, never blocks the paste.
        loadHistory();
      };
      try {
        // FAST PATH: a speculation covers this exact utterance → commit the
        // parked result (paste happens in main during this call). ANY commit
        // failure (miss, IPC error) falls through to the classic path — the
        // final clip is still in hand, worst case is today's latency.
        if (stats?.spec?.id && stats.spec.id === dispatchedSpecRef.current) {
          try {
            const res = await window.parlys.transcribeCommit({ specId: stats.spec.id });
            if (res && !res.specMiss) { await finish(res); return; }
          } catch { /* classic below */ }
        }
        const audioBase64 = await blobToBase64(blob);
        const res = await window.parlys.transcribe({
          audioBase64,
          mimeType,
          language: settings.language === 'auto' ? undefined : settings.language,
          translateTo: settings.translateTo || undefined,
          mode: settings.mode,
          audioMs,
          speechMs: stats?.speechMs,
          speech: stats?.speechMeta ?? undefined,
        });
        await finish(res);
      } catch (err: any) {
        showError(err?.message || String(err));
      }
    },
    // stop() decided not to ship (no speech / dead mic / too short) —
    // explanatory note; the benign ones self-clear after 3 s (showError).
    onDrop: (reason) => {
      setAudioLevel(0);
      showError(reason);
    },
    onError: (err) => {
      showError(err.message);
    },
  });

  // Hold the latest recState in a ref so the IPC handler never reads a
  // stale value. Without this, the listener captured whatever recState
  // was when the effect last ran; a shortcut press that arrived during
  // the ~1-frame window between setRecState('recording') and the
  // effect's re-run would wrongly be treated as "still idle" and issue
  // a second recorder.start() instead of recorder.stop().
  const recStateRef = useRef(recState);
  recStateRef.current = recState;

  const toggle = async () => {
    const current = recStateRef.current;
    if (current === 'recording') { recorder.stop(); return; }
    if (current === 'processing') return;
    clearBenignTimer();
    setLastError('');
    setRecState('recording');
    // Fire TLS warm-up for Groq the moment recording begins — by the
    // time the user stops speaking the HTTPS socket is hot, shaving
    // 40-80 ms off the Whisper round-trip. The compact pill flow was
    // missing this, MainView already had it.
    try { (window.parlys as any).prewarm?.(); } catch { /* best-effort */ }
    await recorder.start();
  };

  // Global shortcut forwarded from main. Registered ONCE so we never
  // double-register during rapid state changes, and dispatches through
  // the ref-backed toggle above.
  useEffect(() => {
    const unsub = window.parlys.onToggleRecording(() => {
      try { window.parlys.log?.('[compact] ON_TOGGLE_RECORDING received, recState=', recStateRef.current); } catch {}
      toggle();
    });
    return () => unsub?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard shortcuts when the pill is focused:
  //   Space  → toggle
  //   Esc    → stop if recording
  // Registered ONCE with deps=[]: recState is read through recStateRef
  // so we never capture a stale value, and recorder.stop is safe to
  // call from a stale reference because useAudioRecorder returns a
  // stable callback across renders.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space' && !e.repeat) { e.preventDefault(); toggle(); }
      if (e.code === 'Escape' && recStateRef.current === 'recording') recorder.stop();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const expand = async () => {
    await window.parlys.windowResizeForDensity?.('comfortable');
  };

  const openContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.parlys.showWidgetContextMenu?.();
  };

  const bars = useMiniWaveform(audioLevel, recState === 'recording');

  // Regression sampler for the hover oscillation test. Dormant in
  // production; activated only when main sets PARLYS_PILL_SAMPLER=1
  // (which appends "-sampler" to the URL hash). Samples the pill's
  // rendered width and :hover state every 100 ms so `test-hover.js` can
  // assert the expansion is monotonically stable on a stationary
  // cursor.
  useEffect(() => {
    if (!window.location.hash.includes('sampler')) return;
    let mmCount = 0;
    const onMM = () => { mmCount++; };
    window.addEventListener('mousemove', onMM);
    const id = setInterval(() => {
      const pill = document.querySelector('.pill') as HTMLElement | null;
      const compact = document.querySelector('.density-compact') as HTMLElement | null;
      const w = pill?.getBoundingClientRect().width ?? 0;
      const hover = !!compact?.matches(':hover');
      const bg = pill ? getComputedStyle(pill).backgroundImage : 'none';
      const isGlass = bg && bg !== 'none' && bg.includes('linear-gradient');
      // Ground-truth: what element is Chromium actually hit-testing at
      // the window centre? If this is null, the pixel is click-through
      // at the DWM level (transparent compositor output) and :hover
      // can NEVER fire whatever we do in CSS.
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      const hitEl = document.elementFromPoint(cx, cy);
      const hitClass = hitEl ? (hitEl.className || hitEl.tagName) : 'null';
      console.log(`[pill-sampler] w=${w.toFixed(1)} hover=${hover} glass=${isGlass} mm=${mmCount} hit=${String(hitClass).slice(0, 40)}`);
    }, 100);
    return () => {
      clearInterval(id);
      window.removeEventListener('mousemove', onMM);
    };
  }, []);

  // SINGLE-FACE pill (v1.10.3): one constant layout in every state — the
  // user's contract after the two-face capsule↔full swap read as "the
  // pill changes size while I speak" and left the buttons visually
  // outside the tiny idle capsule. States now only recolor the SAME
  // mic + body + expand row, all contained in the always-painted dark
  // pill. `is-idle` merely dims it slightly (CSS opacity).
  const isTrueIdle = recState === 'idle' && !justDone;

  return (
    <div
      className={`pill-root state-${recState} ${justDone ? 'done-flash' : ''} ${isTrueIdle ? 'is-idle' : 'is-forced-expanded'}`}
      onContextMenu={openContextMenu}
    >
      <div className="pill">
        <button
          className="pill-mic no-drag"
          onClick={toggle}
          onDoubleClick={expand}
          disabled={recState === 'processing'}
          title={recState === 'recording' ? 'Arrêter la dictée' : 'Démarrer la dictée'}
        >
          {recState === 'processing' ? <Loader2 size={15} className="animate-spin" /> :
           recState === 'recording'  ? <Square size={11} fill="currentColor" /> :
           recState === 'error'      ? <AlertCircle size={14} /> :
           justDone                  ? <Check size={14} /> :
                                       <Mic size={14} />}
        </button>

        <div className="pill-body" onDoubleClick={expand}>
          {recState === 'recording' ? (
            <div className="pill-wave">
              {bars.map((h, i) => (
                // scaleY (GPU-composited) instead of height (relayout) — a
                // relayout here can invalidate the transparent pill's
                // composited layer and flip :hover (documented elsewhere).
                <span key={i} className="pill-wave-bar" style={{ transform: `scaleY(${h})` }} />
              ))}
            </div>
          ) : recState === 'processing' ? (
            <span className="pill-label pill-label-cyan">Transcription…</span>
          ) : recState === 'error' ? (
            // No JS slice — CSS (nowrap + ellipsis) truncates to the real
            // ~80px body width, so the ellipsis always lands correctly.
            // Full text stays in the title attribute.
            <span className="pill-label pill-label-amber" title={lastError}>
              {lastError || 'Erreur'}
            </span>
          ) : justDone ? (
            // Drop the latency suffix in compact — it overflows the ~80px
            // body. The full stat lives in the comfortable view.
            <span className="pill-label pill-label-green">Injecté</span>
          ) : lastTranscript ? (
            <span className="pill-label pill-label-faded" title={lastTranscript}>
              {lastTranscript}
            </span>
          ) : (
            <span className="pill-label">Parler</span>
          )}
        </div>

        <button
          className="pill-expand no-drag"
          onClick={expand}
          title="Mode confortable"
        >
          <Maximize2 size={13} />
        </button>

        {/* Passive idle indicator — a centered dot, absolutely positioned
            so it never affects the flex layout. Visible ONLY at idle
            without hover (CSS opacity swap with the controls above); the
            pill's dark capsule and its geometry stay identical in every
            state. */}
        <span className="pill-idle-dot" aria-hidden="true" />
      </div>
    </div>
  );
}

// Short waveform for the pill (12 bars, tiny amplitude). Animates only
// while `active` is true; when idle, it collapses to a resting array
// exactly ONCE and stops — no 70 ms re-render loop. This matters because
// every React commit reconciles the pill's descendants, and on Windows +
// transparent compositor that occasionally invalidates the pill's
// composited layer and flips :hover to false under a stationary cursor.
// Returns 12 normalized scale values (0..1) for `transform: scaleY()`.
const MINI_REST = 0.15;
function useMiniWaveform(level: number, active: boolean): number[] {
  const [bars, setBars] = useState<number[]>(() => new Array(12).fill(MINI_REST));
  const levelRef = useRef(level);
  levelRef.current = level;
  useEffect(() => {
    if (!active) {
      // Reset to rest exactly once, then stay quiet.
      setBars((prev) => (prev.every((b) => b === MINI_REST) ? prev : new Array(12).fill(MINI_REST)));
      return;
    }
    // Honour prefers-reduced-motion (matches MainView.useWaveform): freeze to a
    // static mid bar instead of running the 70 ms animation loop.
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setBars(new Array(12).fill(0.5)); return; }
    const id = setInterval(() => {
      setBars((prev) => {
        const next = prev.slice(1);
        next.push(Math.min(1, 0.15 + levelRef.current * 0.85 + Math.random() * 0.1));
        return next;
      });
    }, 70);
    return () => clearInterval(id);
  }, [active]);
  return bars;
}
