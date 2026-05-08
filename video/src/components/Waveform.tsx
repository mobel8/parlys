/**
 * Waveform — animated audio-bar array.
 *
 * Two modes:
 *   - "live"     : each bar follows a sine-based height that makes
 *                  the array look like it's reacting to real audio.
 *   - "triggered": the bars stay flat until a `triggerFrame`, then
 *                  a wave sweeps across (used when the voice pipeline
 *                  finishes and a "speak" burst arrives).
 *
 * Colors interpolate along the brand gradient so each bar carries
 * a slightly different hue — a trick borrowed from Cartesia's own
 * marketing which is visually unmistakable.
 */
import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { BRAND } from '../lib/theme';

interface Props {
  bars?: number;
  width?: number;
  height?: number;
  mode?: 'live' | 'triggered';
  triggerFrame?: number;
  colorStart?: string;
  colorEnd?: string;
  intensity?: number;
}

export const Waveform: React.FC<Props> = ({
  bars = 48,
  width = 480,
  height = 120,
  mode = 'live',
  triggerFrame = 0,
  colorStart = BRAND.purple,
  colorEnd = BRAND.pink,
  intensity = 1,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const barWidth = (width / bars) * 0.6;
  const gap = (width / bars) * 0.4;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        height,
        width,
        gap,
      }}
    >
      {Array.from({ length: bars }).map((_, i) => {
        const phase = i * 0.35;
        const pos = i / (bars - 1);

        // For "live" mode — a layered sine gives a realistic jitter.
        const liveAmp =
          0.4 * Math.sin(t * 3.2 + phase) +
          0.35 * Math.sin(t * 6.7 + phase * 1.8) +
          0.25 * Math.sin(t * 12.1 + phase * 2.6);
        const liveHeight = height * (0.12 + Math.abs(liveAmp) * 0.55) * intensity;

        // "triggered" mode — a Gaussian pulse travels along the bars.
        const pulseProgress = interpolate(
          frame - triggerFrame,
          [0, 90],
          [-0.2, 1.2],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
        );
        const distance = Math.abs(pos - pulseProgress);
        const pulse = Math.exp(-30 * distance * distance);
        const triggerHeight = height * (0.08 + pulse * 0.9) * intensity;

        const h =
          mode === 'live'
            ? liveHeight
            : Math.max(triggerHeight, height * 0.08);

        // Color interpolation along the bar index
        const color = lerpHex(colorStart, colorEnd, pos);

        return (
          <div
            key={i}
            style={{
              width: barWidth,
              height: h,
              borderRadius: barWidth,
              background: `linear-gradient(180deg, ${color}, ${color}aa)`,
              boxShadow: `0 0 ${barWidth * 0.8}px ${color}88`,
              transition: 'height 40ms linear',
            }}
          />
        );
      })}
    </div>
  );
};

/**
 * Linear interpolate two hex colours. Tiny helper — avoids a full
 * color library import for the 3 LOC we actually need.
 */
function lerpHex(a: string, b: string, t: number): string {
  const ah = parseInt(a.slice(1), 16);
  const bh = parseInt(b.slice(1), 16);
  const ar = (ah >> 16) & 0xff, ag = (ah >> 8) & 0xff, ab = ah & 0xff;
  const br = (bh >> 16) & 0xff, bg = (bh >> 8) & 0xff, bb = bh & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0')}`;
}
