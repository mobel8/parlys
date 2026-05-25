/**
 * useAudioCalibration — one-shot ambient-noise measurement.
 *
 * Opens a short-lived MediaStream + AnalyserNode, samples the mic RMS for
 * ~700 ms, then derives VAD thresholds:
 *   noiseFloor    = p95 of observed RMS (ignores the brief startup spike)
 *   softThreshold = max(0.012, noiseFloor * 2.0)
 *   hardThreshold = max(0.022, noiseFloor * 3.5)
 *   silenceEnd    = max(0.010, noiseFloor * 1.8)
 *
 * The floor values guarantee the thresholds never collapse to ~0 in an
 * unusually silent room, which would otherwise make every keyboard click
 * trigger the recorder.
 *
 * Cleanup is exhaustive: stream tracks stopped, AudioContext closed, rAF
 * cancelled — so calling calibrate() repeatedly is safe.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface CalibrationResult {
  noiseFloor: number;
  softThreshold: number;
  hardThreshold: number;
  silenceEnd: number;
  samplesCount: number;
}

export interface UseAudioCalibrationHandle {
  calibrating: boolean;
  lastResult: CalibrationResult | null;
  /** Run the calibration. Resolves with the derived thresholds. */
  calibrate: (deviceId?: string, durationMs?: number) => Promise<CalibrationResult>;
}

const DEFAULT_DURATION_MS = 700;

export function useAudioCalibration(): UseAudioCalibrationHandle {
  const [calibrating, setCalibrating] = useState(false);
  const [lastResult, setLastResult] = useState<CalibrationResult | null>(null);
  // Track the in-flight resources so React unmount during calibration
  // doesn't leak a MediaStream and a hot AudioContext.
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const cleanup = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (ctxRef.current) {
      try { ctxRef.current.close(); } catch { /* ignore */ }
      ctxRef.current = null;
    }
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const calibrate = useCallback(async (deviceId?: string, durationMs = DEFAULT_DURATION_MS): Promise<CalibrationResult> => {
    cleanup();
    setCalibrating(true);
    try {
      const audio: MediaTrackConstraints = deviceId
        ? { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        : { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
      const stream = await navigator.mediaDevices.getUserMedia({ audio });
      streamRef.current = stream;
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.3;
      src.connect(analyser);

      const buf = new Uint8Array(analyser.fftSize);
      const samples: number[] = [];
      const t0 = performance.now();

      await new Promise<void>((resolve) => {
        const tick = () => {
          if (performance.now() - t0 >= durationMs) { resolve(); return; }
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          samples.push(Math.sqrt(sum / buf.length));
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      });

      // p95 is more robust than max — a single keyboard tap shouldn't blow
      // the threshold sky-high. p95 also brushes off the initial gain-spike
      // some mics produce on the first ~50ms after track open.
      samples.sort((a, b) => a - b);
      const p95Idx = Math.max(0, Math.floor(samples.length * 0.95) - 1);
      const noiseFloor = samples[p95Idx] || 0;

      const result: CalibrationResult = {
        noiseFloor,
        softThreshold: Math.max(0.012, noiseFloor * 2.0),
        hardThreshold: Math.max(0.022, noiseFloor * 3.5),
        silenceEnd:    Math.max(0.010, noiseFloor * 1.8),
        samplesCount:  samples.length,
      };
      setLastResult(result);
      return result;
    } finally {
      cleanup();
      setCalibrating(false);
    }
  }, [cleanup]);

  return { calibrating, lastResult, calibrate };
}
