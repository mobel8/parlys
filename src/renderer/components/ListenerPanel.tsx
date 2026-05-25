import React, { useEffect, useRef, useState } from 'react';
import { Play, Square, Headphones, Trash2, Copy, Check, Loader2, Volume2 } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { useListener } from '../hooks/useListener';
import { InterpretPlayer, InterpretPlayerQueue } from '../lib/interpret-player';
import type { ListenerSegment, InterpretChunkEvent } from '../../shared/types';

/**
 * Floating listener panel — shows a live transcription of what the
 * selected input device captures, translated on the fly.
 *
 * Two variants via the `variant` prop:
 *   - 'inline'  : renders as a glass card; used inside MainView.
 *   - 'modal'   : (future) would render as a dedicated floating window.
 *
 * Behaviour:
 *   - start/stop button toggles the listener hook.
 *   - auto-scrolls the transcript as new segments arrive.
 *   - if `listenerMode === 'audio'`, we kick off a one-off
 *     `InterpretPlayer` for each new segment with the translated text,
 *     so the user hears a voice-over. We reuse the existing interpret
 *     IPC for this (Whisper is skipped because the text is already
 *     translated — a tiny overhead worth the code reuse).
 *   - Each segment shows source transcription above and translated
 *     text below in a more prominent style. Copy button per segment.
 */

interface Props {
  variant?: 'inline' | 'modal';
}

export function ListenerPanel({ variant = 'inline' }: Props) {
  const { settings } = useStore();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastSpokenIdRef = useRef<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  /**
   * Strict FIFO queue of TTS players so multiple listener segments
   * NEVER overlap — if the other speaker emits two sentences quickly,
   * the second one buffers quietly until the first has finished
   * playing.
   */
  const queueRef = useRef<InterpretPlayerQueue | null>(null);
  if (!queueRef.current) {
    queueRef.current = new InterpretPlayerQueue((err) => console.warn('[listener:speak]', err.message));
  }

  // Subscribe once to interpret-chunk events and route each to its
  // matching player via the queue (match-by-requestId is done inside
  // `InterpretPlayer.push`).
  useEffect(() => {
    const api = (window as any).voiceink;
    if (!api?.onInterpretChunk) return;
    const off = api.onInterpretChunk((chunk: InterpretChunkEvent) => {
      queueRef.current?.route(chunk);
    });
    return () => { try { off?.(); } catch { /* ignore */ } };
  }, []);

  const listener = useListener({
    targetLang: () => settings.listenerTargetLang || 'fr',
    inputDeviceId: () => settings.listenerInputDeviceId || undefined,
    sourceLang: () => undefined, // always auto-detect
    onError: (err) => console.warn('[listener]', err.message),
  });

  // Auto-scroll when new segments arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [listener.segments.length]);

  // Audio mode — speak each new *translated* segment via TTS. Gated
  // by BOTH `listenerMode === 'audio'` (per-feature toggle) AND the
  // global `speakTranslations` master (same kill-switch that silences
  // the interpreter). When the master is OFF, we don't even hit IPC.
  useEffect(() => {
    if ((settings.listenerMode || 'text') !== 'audio') return;
    if (settings.speakTranslations === false) return;
    const segs = listener.segments;
    if (segs.length === 0) return;
    const last = segs[segs.length - 1];
    if (!last || last.speaking) return;
    if (last.id === lastSpokenIdRef.current) return;
    if (!last.translated?.trim()) return;
    lastSpokenIdRef.current = last.id;
    const requestId = `spk-${last.id}`;
    const queue = queueRef.current!;
    const player = new InterpretPlayer(requestId, {
      onEnd: () => queue.advance(player),
      onError: (err) => {
        console.warn('[listener:speak]', err.message);
        queue.advance(player);
      },
    }, { sinkId: settings.ttsSinkId || undefined, autoStart: false });
    queue.add(player);
    (window as any).voiceink?.speak({
      requestId,
      text: last.translated,
      language: settings.listenerTargetLang || 'fr',
    }).catch((err: any) => {
      console.warn('[listener:speak]', err?.message || err);
      player.dispose();
      queue.advance(player);
    });
  }, [listener.segments, settings.listenerMode, settings.listenerTargetLang, settings.ttsSinkId, settings.speakTranslations]);

  const copyToClipboard = async (seg: ListenerSegment) => {
    const text = seg.translated ? `${seg.text}\n→ ${seg.translated}` : seg.text;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(seg.id);
      setTimeout(() => setCopiedId(null), 1200);
    } catch { /* ignore */ }
  };

  const bars = Math.max(0, Math.min(1, listener.level)) * 20;
  const enabled = !!settings.listenerEnabled;

  return (
    <div className={`glass rounded-2xl p-4 space-y-3 ${variant === 'inline' ? '' : 'fixed inset-4'}`}>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center
            ${listener.isActive ? 'bg-sky-500/20 ring-1 ring-sky-400/40' : 'bg-white/5'}`}>
            <Headphones size={14} className={listener.isActive ? 'text-sky-300' : 'text-white/60'} />
          </div>
          <div>
            <div className="font-medium text-sm">Écoute conversation</div>
            <div className="text-[11px] text-white/50">
              {listener.isActive
                ? `${listener.segments.length} segments · ${settings.listenerTargetLang?.toUpperCase()}`
                : enabled ? 'Prêt à démarrer' : 'Activez le mode dans Paramètres'}
            </div>
          </div>
        </div>

        {/* Live level meter */}
        {listener.isActive && (
          <div className="flex-1 flex items-center justify-center gap-0.5 px-3">
            {[...Array(20)].map((_, i) => (
              <div
                key={i}
                className={`w-0.5 rounded-full transition-all duration-75 ${i < bars ? 'bg-sky-400' : 'bg-white/10'}`}
                style={{ height: i < bars ? `${4 + (i / 20) * 16}px` : '4px' }}
              />
            ))}
          </div>
        )}

        <div className="flex items-center gap-1 ml-auto">
          <button
            type="button"
            onClick={listener.clearSegments}
            disabled={listener.segments.length === 0}
            className="btn btn-ghost text-xs disabled:opacity-30"
            title="Effacer les segments affichés"
          >
            <Trash2 size={12} />
          </button>
          <button
            type="button"
            onClick={() => listener.isActive ? listener.stop() : listener.start()}
            disabled={!enabled}
            className={`btn text-xs inline-flex items-center gap-1.5 ${listener.isActive ? 'btn-primary' : 'btn-ghost'}`}
          >
            {listener.isActive
              ? (<><Square size={12} /> Arrêter</>)
              : (<><Play size={12} /> Écouter</>)}
          </button>
        </div>
      </div>

      {/* Transcript area */}
      <div
        ref={scrollRef}
        className="relative rounded-xl border border-white/10 bg-black/30 p-3 min-h-[200px] max-h-[420px] overflow-y-auto space-y-3"
      >
        {listener.segments.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-center text-white/40 text-xs">
            {listener.isActive
              ? 'En attente de parole…'
              : enabled
                ? 'Cliquez sur « Écouter » pour démarrer la transcription en direct.'
                : 'Activez « Écouter une conversation » dans les paramètres.'}
          </div>
        )}
        {listener.segments.map((seg) => (
          <div key={seg.id} className="group relative">
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                {seg.speaking ? (
                  <div className="text-white/60 text-sm inline-flex items-center gap-2">
                    <Loader2 size={12} className="animate-spin" />
                    Transcription en cours…
                  </div>
                ) : (
                  <>
                    <div className="text-white/70 text-xs font-mono tabular-nums leading-snug whitespace-pre-wrap break-words">
                      {seg.text}
                    </div>
                    {seg.translated && seg.translated !== seg.text && (
                      <div className="text-sky-200 text-sm mt-1 leading-snug whitespace-pre-wrap break-words">
                        → {seg.translated}
                      </div>
                    )}
                  </>
                )}
                <div className="mt-1 flex items-center gap-2 text-[10px] text-white/40">
                  <span>{new Date(seg.ts).toLocaleTimeString()}</span>
                  {seg.sourceLang && <span className="px-1 rounded bg-white/5">{seg.sourceLang.toUpperCase()}</span>}
                  {seg.audioMs > 0 && <span>{(seg.audioMs / 1000).toFixed(1)}s</span>}
                </div>
              </div>
              {!seg.speaking && seg.text && (
                <button
                  type="button"
                  onClick={() => copyToClipboard(seg)}
                  className="opacity-0 group-hover:opacity-100 transition w-7 h-7 rounded-md hover:bg-white/10 flex items-center justify-center text-white/50 hover:text-white/90"
                  title="Copier"
                >
                  {copiedId === seg.id ? <Check size={11} className="text-green-300" /> : <Copy size={11} />}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {settings.listenerMode === 'audio' && (
        <div className="text-[10px] text-white/40 inline-flex items-center gap-1">
          <Volume2 size={10} /> La traduction est également prononcée via le moteur TTS.
        </div>
      )}
    </div>
  );
}

