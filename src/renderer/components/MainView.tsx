import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Loader2, Copy, Check, ClipboardPaste, AlertCircle, Zap, Key, ArrowRight, Languages, Globe, Volume2, VolumeX, Radio } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { useContinuousInterpreter } from '../hooks/useContinuousInterpreter';
import { MODE_LABELS, SUPPORTED_LANGUAGES, TRANSLATE_TARGETS, INTERPRETER_LANGUAGES } from '../lib/constants';
import { Mode } from '../../shared/types';
import { InterpretPlayer } from '../lib/interpret-player';
import { ListenerPanel } from './ListenerPanel';
import { VoiceQuickPopover } from './VoiceQuickPopover';
import { blobToBase64 } from '../lib/blob';
import { useT } from '../lib/i18n';

export function MainView() {
  const {
    settings,
    setView,
    recState, setRecState,
    lastTranscript, setLastTranscript,
    lastLatencyMs, setLastLatencyMs,
    lastError, setLastError,
    audioLevel, setAudioLevel,
    loadHistory,
  } = useStore();
  const t = useT();
  const hasKey = !!settings.groqApiKey;

  const [copied, setCopied] = useState(false);
  // TTFB stats for the interpreter. Rendered as a small badge when
  // the last session produced audio.
  const [lastTtfbMs, setLastTtfbMs] = useState(0);
  // Active MediaSource-backed audio player (interpreter only). Lives
  // across renders via ref so component unmount cleans it up.
  const playerRef = useRef<InterpretPlayer | null>(null);
  // Subscription to main-process chunk events. Installed once, routed
  // to the active player by requestId.
  useEffect(() => {
    const api = (window as any).voiceink;
    if (!api?.onInterpretChunk) return;
    const unsub = api.onInterpretChunk((chunk: any) => {
      playerRef.current?.push(chunk);
    });
    return () => {
      try { unsub?.(); } catch { /* ignore */ }
      playerRef.current?.dispose();
      playerRef.current = null;
    };
  }, []);

  const recorder = useAudioRecorder({
    onLevel: (rms) => setAudioLevel(rms),
    onStop: async (blob, mimeType) => {
      setRecState('processing');
      setAudioLevel(0);
      const t0 = Date.now();
      try {
        const audioBase64 = await blobToBase64(blob);

        // ----- Interpreter path ---------------------------------------------
        // When the toggle is ON, route through the voice-to-voice
        // pipeline instead of the classic dictation pipeline.
        if (settings.interpreterEnabled) {
          playerRef.current?.dispose();
          const requestId = `int-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const targetLang = settings.interpretTargetLang || 'en';
          // Only wire up an audio player when the global master switch
          // is ON. When it's OFF, main still sends a single done-sentinel
          // over ON_INTERPRET_CHUNK — skipping the player entirely keeps
          // us from constructing a MediaSource we'd immediately dispose.
          if (settings.speakTranslations !== false) {
            const player = new InterpretPlayer(requestId, {
              onFirstChunk: (clientMs) => setLastTtfbMs(clientMs),
              onError: (err) => console.warn('[interpret-player]', err.message),
            }, { sinkId: settings.ttsSinkId });
            playerRef.current = player;
          } else {
            playerRef.current = null;
          }
          const res = await window.voiceink.interpret({
            requestId,
            audioBase64,
            mimeType,
            sourceLang: settings.language === 'auto' ? undefined : settings.language,
            targetLang,
          });
          setLastLatencyMs(Date.now() - t0);
          if (!res.ok) {
            setLastError(res.error || 'Erreur inconnue');
            setRecState('error');
            return;
          }
          setLastTranscript(`${res.rawText}\n\n→ ${res.translatedText}`);
          setRecState('idle');
          setLastError('');
          if (typeof res.ttfbMs === 'number') setLastTtfbMs(res.ttfbMs);
          loadHistory();
          return;
        }

        // ----- Classic dictation path ---------------------------------------
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
  // stale value. Same fix as CompactView — without it, a shortcut press
  // arriving during the ~1-frame window between setRecState('recording')
  // and the effect's re-run would see the old 'idle' value and try to
  // start a second recorder on top of the first.
  const recStateRef = useRef(recState);
  recStateRef.current = recState;

  // Continuous interpreter (niveau 2 : VAD simultané). Active quand
  // `interpreterEnabled && interpreterContinuous`. Le hook capte en
  // permanence et fire `interpret()` à chaque fin de phrase détectée.
  const continuous = useContinuousInterpreter({
    targetLang: () => settings.interpretTargetLang || 'en',
    sourceLang: () => (settings.language === 'auto' ? undefined : settings.language),
    sinkId: () => settings.ttsSinkId || undefined,
    speakEnabled: () => settings.speakTranslations !== false,
    onLevel: (rms) => setAudioLevel(rms),
    onPhraseStart: () => {
      // On passe en 'processing' pour que l'UI reflète l'activité TTS
      // tant qu'une traduction au moins est en vol. Le retour à 'recording'
      // se fera sur onPhraseDone (puisqu'on reste en capture continue).
    },
    onPhraseDone: (res) => {
      if (res.ok) {
        setLastTranscript(`${res.rawText}\n\n→ ${res.translatedText}`);
        if (typeof res.ttfbMs === 'number') setLastTtfbMs(res.ttfbMs);
        setLastLatencyMs(res.durationMs);
        loadHistory();
      } else {
        setLastError(res.error || 'Erreur interprétation');
      }
    },
    onError: (err) => {
      console.warn('[continuous-interpreter]', err.message);
    },
  });

  const toggle = async () => {
    const current = recStateRef.current;
    const useContinuous = settings.interpreterEnabled && settings.interpreterContinuous;

    if (useContinuous) {
      // Mode VAD continu : un seul clic lance la capture, un autre l'arrête.
      if (current === 'recording') {
        continuous.stop();
        setRecState('idle');
        setAudioLevel(0);
      } else {
        setLastError('');
        setLastTranscript('');
        setRecState('recording');
        // Fire TLS warm-up for Groq + TTS the moment recording begins —
        // by the time the user stops speaking (2-30 s later) the HTTPS
        // sockets are hot, shaving ~50-80 ms off Whisper + translate + TTS.
        try { (window.voiceink as any).prewarm?.(); } catch { /* best-effort */ }
        try {
          await continuous.start();
        } catch (err: any) {
          setLastError(err?.message || String(err));
          setRecState('error');
        }
      }
      return;
    }

    // Mode classique / interprète non-continu : start/stop MediaRecorder unique.
    if (current === 'recording') {
      recorder.stop();
    } else if (current === 'idle' || current === 'error') {
      setLastError('');
      setLastTranscript('');
      setRecState('recording');
      // Same trick as the continuous branch above: warm the HTTPS
      // sockets while the user is still speaking.
      try { (window.voiceink as any).prewarm?.(); } catch { /* best-effort */ }
      await recorder.start();
    }
  };

  // Global toggle shortcut from main. Registered ONCE so there is never
  // a gap between unsubscribe-old and subscribe-new during rapid state
  // transitions; the toggle() above reads the ref, not the closure.
  useEffect(() => {
    const unsub = window.voiceink.onToggleRecording(() => toggle());
    return () => unsub?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard: Space to toggle (when focused on main view, not in input).
  // Registered ONCE; recState reads go through recStateRef so there's
  // never a stale-closure window between React state commits and the
  // effect re-running (same contract as CompactView).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space' && !e.repeat) { e.preventDefault(); toggle(); }
      if (e.code === 'Escape' && recStateRef.current === 'recording') { recorder.stop(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copy = async () => {
    if (!lastTranscript) return;
    await window.voiceink.copyText(lastTranscript);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  const inject = async () => {
    if (!lastTranscript) return;
    await window.voiceink.injectText(lastTranscript);
  };

  const bars = useWaveform(audioLevel, recState === 'recording');

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="pt-6 pb-3 flex items-end justify-between gap-4 flex-wrap" style={{ paddingLeft: 'clamp(1rem, 2.5vw, 1.5rem)', paddingRight: 'clamp(1rem, 2.5vw, 1.5rem)' }}>
        <div className="min-w-0 flex-1" style={{ minWidth: 'min(14rem, 60%)' }}>
          <h1 className="text-2xl font-bold tracking-tight truncate">
            <span className="gradient-text">{t('main.title')}</span>
          </h1>
          <p className="text-white/50 text-xs mt-1">
            {t('main.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
          <ModePicker />
          <LanguagePicker />
          <TranslatePicker />
          <InterpreterPicker />
        </div>
      </div>

      {/* Setup banner: no API key yet */}
      {!hasKey && (
        <div className="mx-6 mb-3 glass rounded-xl px-4 py-3 flex items-center gap-3 slide-up" style={{ borderColor: 'rgba(251,191,36,0.35)' }}>
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 grid place-items-center shadow-lg shadow-amber-500/30 shrink-0">
            <Key size={14} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm">Configurez votre clé Groq pour commencer</div>
            <div className="text-white/60 text-xs mt-0.5 truncate">
              Gratuite sur <a className="text-amber-300 hover:underline" href="https://console.groq.com/keys" target="_blank" rel="noreferrer">console.groq.com/keys</a>. Stockée localement.
            </div>
          </div>
          <button className="btn btn-primary !text-xs !py-1.5" onClick={() => setView('settings')}>
            Paramètres <ArrowRight size={12} />
          </button>
        </div>
      )}

      {/* Record area.
          Grid template uses minmax to guarantee the big mic area never gets
          crushed below 280px when the optional ListenerPanel renders as a
          third row — without that minimum, 3 children + `1fr auto` squeezed
          row 1 down to ~110px and the centered button + label + wave
          overflowed visibly above the parent. main carries overflow-auto so
          the ListenerPanel can scroll if the window is short. */}
      <div className={`flex-1 min-h-0 grid pb-5 gap-4 ${settings.listenerEnabled ? 'grid-rows-[minmax(280px,1fr)_auto_auto]' : 'grid-rows-[1fr_auto]'}`} style={{ paddingLeft: 'clamp(1rem, 2.5vw, 1.5rem)', paddingRight: 'clamp(1rem, 2.5vw, 1.5rem)' }}>
        <div className="glass-strong rounded-2xl flex flex-col items-center justify-center p-6 relative overflow-hidden min-h-[280px]">
          {/* Ambient dots */}
          <div className="absolute inset-0 opacity-[0.06]" style={{
            backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
            backgroundSize: '24px 24px'
          }} />
          <div className="relative z-10 flex flex-col items-center gap-4">
            <div className="relative">
              <div className={`record-halo ${recState === 'recording' ? 'recording' : ''}`} />
              <button
                className={`record-btn ${recState === 'recording' ? 'recording' : ''} ${recState === 'processing' ? 'processing' : ''}`}
                onClick={toggle}
                disabled={recState === 'processing' || !hasKey}
                title={!hasKey ? 'Configurez la clé API Groq d\'abord' : (recState === 'recording' ? 'Arrêter' : 'Démarrer')}
                aria-label={recState === 'recording' ? 'Arrêter l\'enregistrement' : recState === 'processing' ? 'Transcription en cours' : 'Démarrer l\'enregistrement'}
              >
                {recState === 'processing' && <Loader2 size={38} className="animate-spin" />}
                {recState === 'recording' && <Square size={34} fill="white" />}
                {(recState === 'idle' || recState === 'error') && <Mic size={40} />}
              </button>
            </div>

            <div className="text-center min-h-[44px]">
              {recState === 'idle' && (
                <>
                  <div className="text-base font-medium">
                    {settings.interpreterEnabled ? 'Prêt à interpréter' : 'Prêt à vous écouter'}
                  </div>
                  <div className="text-white/40 text-xs mt-0.5">
                    Cliquez ou appuyez sur <kbd className="px-1 py-0.5 rounded bg-white/10 text-white/70 text-[10px] border border-white/10 mx-1">Espace</kbd>
                    {settings.interpreterEnabled && (
                      <> · <Volume2 size={10} className="inline" /> Voix en <span className="text-emerald-300">{INTERPRETER_LANGUAGES.find((t) => t.code === settings.interpretTargetLang)?.label || settings.interpretTargetLang}</span></>
                    )}
                    {!settings.interpreterEnabled && settings.translateTo && (
                      <> · <Languages size={10} className="inline" /> Traduction: <span className="text-fuchsia-300">{TRANSLATE_TARGETS.find((t) => t.code === settings.translateTo)?.native}</span></>
                    )}
                  </div>
                </>
              )}
              {recState === 'recording' && (
                <>
                  <div className="text-base font-medium text-rose-300 flex items-center justify-center gap-2">
                    {settings.interpreterEnabled && settings.interpreterContinuous && (
                      <span className="badge" style={{
                        background: 'rgba(244,63,94,0.15)',
                        borderColor: 'rgba(244,63,94,0.5)',
                        color: '#fda4af',
                      }}>
                        <Radio size={9} /> LIVE
                      </span>
                    )}
                    {settings.interpreterEnabled
                      ? (settings.interpreterContinuous ? 'Interprétation en continu…' : 'Écoute pour interprétation…')
                      : 'Enregistrement…'}
                  </div>
                  <div className="text-white/40 text-xs mt-0.5">Appuyez à nouveau pour arrêter</div>
                </>
              )}
              {recState === 'processing' && (
                <>
                  <div className="text-base font-medium text-cyan-300">
                    {settings.interpreterEnabled ? 'Traduction + synthèse vocale…' : 'Transcription en cours…'}
                  </div>
                  <div className="text-white/40 text-xs mt-0.5">
                    {settings.interpreterEnabled
                      ? <>Whisper Turbo → {settings.llmProvider === 'cerebras' ? 'Cerebras' : 'Groq llama'} → {settings.ttsProvider}</>
                      : <>Whisper Turbo sur Groq{settings.translateTo && <> + traduction</>}</>}
                  </div>
                </>
              )}
              {recState === 'error' && (
                <>
                  <div className="text-base font-medium text-rose-300 flex items-center justify-center gap-1.5">
                    <AlertCircle size={14} /> Oups, une erreur
                  </div>
                  <div className="text-white/50 text-xs mt-0.5 max-w-md">{lastError}</div>
                </>
              )}
            </div>

            {/* Waveform — only visible during recording to reduce ambient
                visual noise when idle. Fades in/out via the wave wrapper
                opacity. */}
            <div
              className="wave w-full max-w-[min(60vw,360px)] transition-opacity duration-200"
              style={{ opacity: recState === 'recording' ? 1 : 0 }}
              aria-hidden="true"
            >
              {bars.map((h, i) => (
                <div key={i} className="bar" style={{ height: `${h}px` }} />
              ))}
            </div>
          </div>
        </div>

        {/* Transcript panel */}
        <div className="glass rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="label">
                {settings.interpreterEnabled ? 'Dernière interprétation' : 'Dernière transcription'}
              </span>
              {lastLatencyMs > 0 && (
                <span className="badge badge-green">
                  <Zap size={9} /> {lastLatencyMs}ms
                </span>
              )}
              {settings.interpreterEnabled && lastTtfbMs > 0 && (
                <span className="badge badge-green" style={{ borderColor: 'rgba(16,185,129,0.35)' }}>
                  <Volume2 size={9} /> voix {lastTtfbMs}ms
                </span>
              )}
            </div>
            <div className="flex gap-1">
              <button className="btn btn-ghost !text-xs !py-1" onClick={copy} disabled={!lastTranscript}>
                {copied ? <><Check size={12} /> Copié</> : <><Copy size={12} /> Copier</>}
              </button>
              <button className="btn btn-ghost !text-xs !py-1" onClick={inject} disabled={!lastTranscript}>
                <ClipboardPaste size={12} /> Coller
              </button>
            </div>
          </div>
          <div
            className="min-h-[68px] max-h-40 overflow-auto text-white/90 text-sm leading-relaxed select-text whitespace-pre-wrap"
            style={{ userSelect: 'text' }}
            role="region"
            aria-live="polite"
            aria-label="Dernière transcription"
          >
            {lastTranscript || (
              <span className="text-white/30 flex items-center gap-2">
                <Mic size={12} className="opacity-50" />
                {hasKey
                  ? 'Appuyez sur Espace ou cliquez sur le micro pour dicter.'
                  : 'Configurez votre clé API Groq dans les paramètres pour commencer.'}
              </span>
            )}
          </div>
        </div>

        {/* Listener panel — renders only when enabled in Settings. */}
        {settings.listenerEnabled && (
          <ListenerPanel variant="inline" />
        )}
      </div>
    </div>
  );
}

function ModePicker() {
  const { settings, updateSettings } = useStore();
  const active = settings.mode !== 'raw';
  const ModeIcon = MODE_LABELS[settings.mode].Icon;
  return (
    <label className={`picker-chip ${active ? 'is-active' : ''}`} title={MODE_LABELS[settings.mode].desc}>
      <ModeIcon size={12} className="picker-chip-icon" />
      <select
        value={settings.mode}
        onChange={(e) => updateSettings({ mode: e.target.value as Mode })}
      >
        {Object.entries(MODE_LABELS).map(([k, v]) => (
          <option key={k} value={k}>{v.icon} {v.label}</option>
        ))}
      </select>
    </label>
  );
}

function LanguagePicker() {
  const { settings, updateSettings } = useStore();
  const active = settings.language !== 'auto';
  return (
    <label className={`picker-chip ${active ? 'is-active' : ''}`} title="Langue de dictée">
      <Globe size={12} className="picker-chip-icon" />
      <select
        value={settings.language}
        onChange={(e) => updateSettings({ language: e.target.value })}
      >
        {SUPPORTED_LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>{l.label}</option>
        ))}
      </select>
    </label>
  );
}

function TranslatePicker() {
  const { settings, updateSettings } = useStore();
  const active = !!settings.translateTo;
  return (
    <label className={`picker-chip ${active ? 'is-active' : ''}`} title="Traduire automatiquement la dictée">
      <Languages size={12} className="picker-chip-icon" />
      <select
        value={settings.translateTo}
        onChange={(e) => updateSettings({ translateTo: e.target.value })}
      >
        {TRANSLATE_TARGETS.map((t) => (
          <option key={t.code || 'none'} value={t.code}>
            {t.code ? `→ ${t.native}` : 'Pas de traduction'}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Combined toggle + target-language picker for the voice interpreter.
 *
 * When OFF, the chip acts as a one-click "Activer l'interprète" toggle
 * and shows just the speaker icon. When ON, it expands with a select
 * for the target language so the user can tune it without opening
 * SettingsView. The 4 dictation modes keep working either way — this
 * is a routing toggle, not a replacement for the mode picker.
 */
function InterpreterPicker() {
  const { settings, updateSettings } = useStore();
  const active = !!settings.interpreterEnabled;
  return (
    <label
      className={`picker-chip ${active ? 'is-active' : ''}`}
      title={active
        ? 'Interprète vocal actif — la traduction sera vocalisée'
        : 'Activer le mode interprète vocal'}
      style={active ? {
        borderColor: 'rgba(16,185,129,0.45)',
        background: 'rgba(16,185,129,0.12)',
      } : undefined}
    >
      <Volume2 size={12} className="picker-chip-icon" style={active ? { color: '#6ee7b7' } : undefined} />
      {active ? (
        <select
          value={settings.interpretTargetLang || 'en'}
          onChange={(e) => updateSettings({ interpretTargetLang: e.target.value })}
          style={{ color: '#6ee7b7' }}
        >
          {INTERPRETER_LANGUAGES.map((t) => (
            <option key={t.code} value={t.code}>→ {t.label}</option>
          ))}
        </select>
      ) : (
        <button
          type="button"
          onClick={() => updateSettings({ interpreterEnabled: true })}
          style={{
            background: 'transparent', border: 'none', color: 'inherit',
            font: 'inherit', cursor: 'pointer', padding: 0,
          }}
        >
          Interprète vocal
        </button>
      )}
      {active && (
        <>
          {/* Quick-access voice + speed picker, right next to the lang
              select, so the user never has to jump into Settings just
              to swap a voice mid-session. */}
          <VoiceQuickPopover />
          {/* Master mute — same behaviour as the Settings toggle but
              one click away. When OFF, only the translated text is
              produced (no TTS call, no audio playback) — saves
              Cartesia/ElevenLabs credits when the user just wants to
              read the translation. */}
          <SpeakMuteQuickToggle />
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); updateSettings({ interpreterEnabled: false }); }}
            title="Désactiver l'interprète vocal"
            style={{
              background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.5)',
              font: 'inherit', cursor: 'pointer', padding: '0 0 0 4px', lineHeight: 1,
            }}
          >
            ×
          </button>
        </>
      )}
    </label>
  );
}

/**
 * Tiny speaker/mute icon-button that flips `settings.speakTranslations`.
 * Rendered inside `InterpreterPicker` whenever the interpreter is on, so
 * the user can silence spoken output (and save TTS credits) with a
 * single click — no need to open Settings.
 */
function SpeakMuteQuickToggle() {
  const { settings, updateSettings } = useStore();
  const on = settings.speakTranslations !== false;
  return (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); updateSettings({ speakTranslations: !on }); }}
      title={on ? 'Couper la voix (texte seul)' : 'Réactiver la voix'}
      aria-label={on ? 'Couper la voix traduite' : 'Activer la voix traduite'}
      aria-pressed={on}
      style={{
        background: 'transparent',
        border: 'none',
        color: on ? '#6ee7b7' : 'rgba(255,255,255,0.45)',
        cursor: 'pointer',
        padding: '0 4px',
        lineHeight: 1,
        display: 'inline-flex',
        alignItems: 'center',
      }}
    >
      {on ? <Volume2 size={12} /> : <VolumeX size={12} />}
    </button>
  );
}

function useWaveform(level: number, active: boolean): number[] {
  const [bars, setBars] = useState<number[]>(() => new Array(48).fill(4));
  const levelRef = useRef(level);
  const activeRef = useRef(active);
  levelRef.current = level;
  activeRef.current = active;

  useEffect(() => {
    const id = setInterval(() => {
      setBars((prev) => {
        const next = prev.slice(1);
        const target = activeRef.current
          ? 6 + levelRef.current * 54 + Math.random() * 6
          : 4 + Math.random() * 2;
        next.push(target);
        return next;
      });
    }, 60);
    return () => clearInterval(id);
  }, []);
  return bars;
}

