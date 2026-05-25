/**
 * AudioLevelMeter — live horizontal mic gauge with VAD-zone colouring.
 *
 * Opens its own MediaStream + AnalyserNode at mount; closes on unmount.
 * Renders a bar whose width tracks the RMS and whose colour switches
 * between three zones:
 *   < soft   → gray (ambient silence)
 *   < hard   → amber (in pre-roll / borderline)
 *   ≥ hard   → emerald (confirmed speech)
 *
 * Designed as a debugging aid for the "Sensibilité micro (VAD)" settings
 * section — lets the user see whether their thresholds catch speech and
 * miss ambient noise.
 */

import { useEffect, useRef, useState } from 'react';

export interface AudioLevelMeterProps {
  /** Soft VAD threshold (RMS 0..1). */
  softThreshold?: number;
  /** Hard VAD threshold (RMS 0..1). */
  hardThreshold?: number;
  /** Show numeric RMS / thresholds beneath the bar. Default true. */
  showLabels?: boolean;
  /** Mic device id (empty = default device). */
  deviceId?: string;
  /** Bar pixel height. */
  height?: number;
  /** Called on every RMS sample (for parent integrations). */
  onLevel?: (rms: number) => void;
}

export function AudioLevelMeter({
  softThreshold = 0.018,
  hardThreshold = 0.032,
  showLabels = true,
  deviceId,
  height = 14,
  onLevel,
}: AudioLevelMeterProps) {
  const [rms, setRms] = useState(0);
  const [error, setError] = useState<string>('');
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  // Use a ref for onLevel so prop changes don't re-mount the AudioContext.
  const onLevelRef = useRef(onLevel);
  onLevelRef.current = onLevel;

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      try {
        const audio: MediaTrackConstraints = deviceId
          ? { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
          : { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
        const stream = await navigator.mediaDevices.getUserMedia({ audio });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const ctx = new AudioContext();
        ctxRef.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.4;
        const src = ctx.createMediaStreamSource(stream);
        src.connect(analyser);

        const buf = new Uint8Array(analyser.fftSize);
        const tick = () => {
          if (cancelled) return;
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          const sample = Math.sqrt(sum / buf.length);
          setRms(sample);
          onLevelRef.current?.(sample);
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || String(e));
      }
    };
    start();
    return () => {
      cancelled = true;
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
      if (ctxRef.current) { try { ctxRef.current.close(); } catch { /* ignore */ } ctxRef.current = null; }
    };
  }, [deviceId]);

  if (error) {
    return (
      <div className="text-rose-300 text-xs">⚠ Micro inaccessible : {error.slice(0, 80)}</div>
    );
  }

  // RMS values for *normal* dictation rarely exceed ~0.2; scale the bar
  // so the user can see meaningful motion at conversational levels.
  const widthPct = Math.min(100, (rms / 0.25) * 100);
  const colour =
    rms >= hardThreshold ? '#10b981' :
    rms >= softThreshold ? '#fbbf24' :
                           '#52525b';

  return (
    <div className="space-y-1.5">
      <div
        className="relative rounded overflow-hidden border border-white/10"
        style={{ height: `${height}px`, background: 'rgba(255,255,255,0.05)' }}
      >
        {/* Threshold tick marks — visual reference for soft/hard zones. */}
        <div className="absolute inset-y-0 w-px bg-white/15"
          style={{ left: `${(softThreshold / 0.25) * 100}%` }} title="soft" />
        <div className="absolute inset-y-0 w-px bg-white/30"
          style={{ left: `${(hardThreshold / 0.25) * 100}%` }} title="hard" />
        {/* The fill bar itself. */}
        <div
          style={{
            width: `${widthPct}%`,
            height: '100%',
            background: colour,
            transition: 'width 60ms linear, background 100ms ease',
          }}
        />
      </div>
      {showLabels && (
        <div className="flex items-center justify-between text-[10px] text-white/45 font-mono">
          <span>RMS {rms.toFixed(3)}</span>
          <span>soft {softThreshold.toFixed(3)} · hard {hardThreshold.toFixed(3)}</span>
        </div>
      )}
    </div>
  );
}
