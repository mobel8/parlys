import React from 'react';
import type { TTSProvider } from '../../shared/types';

/**
 * Client-side mirror of `toCartesiaSpeed()` in `src/main/engines/tts/cartesia.ts`.
 * Kept in sync manually — if you change the thresholds in the main process,
 * update both sides so the UI label matches the actual payload sent.
 */
export function speedBucketFor(ttsSpeed: number): 'slowest' | 'slow' | 'normal' | 'fast' | 'fastest' {
  if (ttsSpeed <= 0.65) return 'slowest';
  if (ttsSpeed <= 0.85) return 'slow';
  if (ttsSpeed <  1.15) return 'normal';
  if (ttsSpeed <  1.45) return 'fast';
  return 'fastest';
}

interface Props {
  /** Current speed factor in the 0.5–2.0 range. */
  value: number;
  /** Fires on every interactive change (throttled by the browser). */
  onChange: (next: number) => void;
  /** Which TTS engine is active — drives the provider-specific hint. */
  provider: TTSProvider;
  /** 'full' shows the label + legend + hint; 'compact' only the track + bucket. */
  density?: 'full' | 'compact';
  /** Optional extra class on the outer wrapper. */
  className?: string;
}

/**
 * Reusable speech-rate slider. Extracted from SettingsView so it can
 * appear both in the main settings page and in the quick-access voice
 * popover that lives in the header/dictation view.
 *
 * Two densities:
 *   - `full`    : label row + range + legend + long hint. Best in Settings.
 *   - `compact` : just the range + live factor readout + Cartesia bucket
 *                 badge. Best in small popovers where space is tight.
 *
 * Cartesia gets a bucket badge (`SLOWEST` / `SLOW` / …) because the API
 * actually quantises the requested speed into five enum values behind
 * the scenes; showing the effective bucket keeps the UI honest.
 */
export function SpeedSlider({ value, onChange, provider, density = 'full', className = '' }: Props) {
  const current = value ?? 1.0;
  const bucket = speedBucketFor(current);

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-2">
        {density === 'full' && <div className="label">Vitesse de parole</div>}
        <span className={`font-mono inline-flex items-center gap-2 ${density === 'compact' ? 'text-[11px] text-white/55' : 'text-xs text-white/60'}`}>
          <span>{current.toFixed(2)}×</span>
          {provider === 'cartesia' && (
            <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] uppercase tracking-wide">
              {bucket}
            </span>
          )}
        </span>
      </div>
      <input
        type="range"
        min={0.5}
        max={2.0}
        step={0.05}
        value={current}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full"
      />
      {density === 'full' && (
        <>
          <div className="flex justify-between text-[10px] text-white/30 mt-1">
            <span>0.5× (lent)</span>
            <span>1.0× (naturel)</span>
            <span>2.0× (rapide)</span>
          </div>
          <p className="text-[11px] text-white/40 mt-2">
            {provider === 'cartesia'
              ? <>Cartesia Sonic-2 quantise la vitesse en 5 paliers (<code>slowest</code>, <code>slow</code>, <code>normal</code>, <code>fast</code>, <code>fastest</code>). <strong>Baisser à <em>slowest</em> ajoute ~20% de durée</strong> — utile si vous voulez que la traduction ait le temps de rattraper un débit rapide.</>
              : provider === 'elevenlabs'
              ? <>ElevenLabs Flash v2.5 accepte une vitesse continue entre 0.7 et 1.2 (clampée). Au-delà, la valeur est ramenée dans la plage.</>
              : <>OpenAI <code>gpt-4o-mini-tts</code> accepte 0.25 – 4.0 mais la qualité se dégrade hors de 0.75 – 1.25.</>}
          </p>
        </>
      )}
    </div>
  );
}
