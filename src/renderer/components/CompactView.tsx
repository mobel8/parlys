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

  const recorder = useAudioRecorder({
    onLevel: (rms) => setAudioLevel(rms),
    onStop: async (blob, mimeType) => {
      setRecState('processing');
      setAudioLevel(0);
      const t0 = Date.now();
      try {
        const audioBase64 = await blobToBase64(blob);
        const res = await window.voiceink.transcribe({
          audioBase64,
          mimeType,
          language: settings.language === 'auto' ? undefined : settings.language,
          translateTo: settings.translateTo || undefined,
          mode: settings.mode,
        });
        setLastLatencyMs(Date.now() - t0);
        if (!res.ok) {
          setLastError(res.error || 'Erreur inconnue');
          setRecState('error');
          return;
        }
        setLastTranscript(res.finalText);
        setRecState('idle');
        setLastError('');
        loadHistory();
        if (settings.autoInject && res.finalText) {
          await window.voiceink.injectText(res.finalText);
        }
        // Flash "done" state briefly before returning to idle label.
        setJustDone(true);
        setTimeout(() => setJustDone(false), 1500);
      } catch (err: any) {
        setLastError(err?.message || String(err));
        setRecState('error');
      }
    },
    onError: (err) => {
      setLastError(err.message);
      setRecState('error');
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
    setLastError('');
    setRecState('recording');
    await recorder.start();
  };

  // Global shortcut forwarded from main. Registered ONCE so we never
  // double-register during rapid state changes, and dispatches through
  // the ref-backed toggle above.
  useEffect(() => {
    const unsub = window.voiceink.onToggleRecording(() => {
      try { window.voiceink.log?.('[compact] ON_TOGGLE_RECORDING received, recState=', recStateRef.current); } catch {}
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
    await window.voiceink.windowResizeForDensity?.('comfortable');
  };

  const openContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.voiceink.showWidgetContextMenu?.();
  };

  const bars = useMiniWaveform(audioLevel, recState === 'recording');

  // Regression sampler for the hover oscillation test. Dormant in
  // production; activated only when main sets VOICEINK_PILL_SAMPLER=1
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

  // Superwhisper-style collapse: tiny dark pill when truly idle. Any
  // activity (recording / processing / error / done flash) forces the
  // full UI. Hover-to-expand on top of the idle state is handled in CSS
  // via `:hover`, not React state — using React here caused a hit-test
  // re-evaluation loop that oscillated between expand and collapse on a
  // stationary cursor.
  const isTrueIdle = recState === 'idle' && !justDone;

  return (
    <div
      className={`pill-root state-${recState} ${justDone ? 'done-flash' : ''} ${isTrueIdle ? 'is-idle' : 'is-forced-expanded'}`}
      onContextMenu={openContextMenu}
    >
      <div className="pill">
        {/*
          Idle (collapsed) face — a small black dot-pill. Clicking it starts
          recording. The whole area is `no-drag` so the click reaches us.
        */}
        <button
          type="button"
          className="pill-idle-face no-drag"
          onClick={toggle}
          onDoubleClick={expand}
          aria-hidden={!isTrueIdle}
          tabIndex={isTrueIdle ? 0 : -1}
          title="Démarrer (Espace) · Double-clic = agrandir"
        >
          <span className="pill-idle-capsule">
            <span className="pill-idle-dot" />
          </span>
        </button>

        {/* Full face — expanded UI with mic button + body + expand. */}
        <div className="pill-full" aria-hidden={isTrueIdle}>
          <button
            className="pill-mic no-drag"
            onClick={toggle}
            onDoubleClick={expand}
            disabled={recState === 'processing'}
            tabIndex={isTrueIdle ? -1 : 0}
            title={
              recState === 'recording' ? 'Arrêter (Espace)' :
              recState === 'processing' ? 'Transcription en cours…' :
              'Démarrer (Espace) · Double-clic = agrandir'
            }
          >
            {recState === 'processing' ? <Loader2 size={15} className="animate-spin" /> :
             recState === 'recording'  ? <Square size={11} fill="currentColor" /> :
             recState === 'error'      ? <AlertCircle size={14} /> :
             justDone                  ? <Check size={14} /> :
                                         <Mic size={14} />}
          </button>

          <div className="pill-body">
            {recState === 'recording' ? (
              <div className="pill-wave">
                {bars.map((h, i) => (
                  <span key={i} className="pill-wave-bar" style={{ height: `${h}px` }} />
                ))}
              </div>
            ) : recState === 'processing' ? (
              <span className="pill-label pill-label-cyan">Transcription…</span>
            ) : recState === 'error' ? (
              <span className="pill-label pill-label-amber" title={lastError}>
                {lastError?.slice(0, 28) || 'Erreur'}
              </span>
            ) : justDone ? (
              <span className="pill-label pill-label-green">
                Injecté{lastLatencyMs > 0 ? ` · ${Math.round(lastLatencyMs)}ms` : ''}
              </span>
            ) : lastTranscript ? (
              <span className="pill-label pill-label-faded" title={lastTranscript}>
                {lastTranscript.slice(0, 24)}{lastTranscript.length > 24 ? '…' : ''}
              </span>
            ) : (
              <span className="pill-label">Parler</span>
            )}
          </div>

          <button
            className="pill-expand no-drag"
            onClick={expand}
            tabIndex={isTrueIdle ? -1 : 0}
            title="Mode confortable"
          >
            <Maximize2 size={11} />
          </button>
        </div>
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
function useMiniWaveform(level: number, active: boolean): number[] {
  const [bars, setBars] = useState<number[]>(() => new Array(12).fill(3));
  const levelRef = useRef(level);
  levelRef.current = level;
  useEffect(() => {
    if (!active) {
      // Reset to rest exactly once, then stay quiet.
      setBars((prev) => (prev.every((b) => b === 3) ? prev : new Array(12).fill(3)));
      return;
    }
    const id = setInterval(() => {
      setBars((prev) => {
        const next = prev.slice(1);
        next.push(3 + levelRef.current * 14 + Math.random() * 2);
        return next;
      });
    }, 70);
    return () => clearInterval(id);
  }, [active]);
  return bars;
}
