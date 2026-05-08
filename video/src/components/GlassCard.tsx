/**
 * GlassCard — the workhorse container used everywhere.
 *
 * Layered effect:
 *   1. Rounded rectangle with translucent ink-700 background
 *   2. 1-px inner stroke (top lit, bottom dark) for physicality
 *   3. Optional aurora border — a conic gradient rotating around
 *      the edge, used for "hero" cards (pricing, interpreter demo).
 *   4. Optional spring-entry animation controlled via `delay`.
 */
import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { sp } from '../lib/spring';
import { EASING } from '../lib/theme';

interface Props {
  children: React.ReactNode;
  width?: number | string;
  height?: number | string;
  padding?: number | string;
  radius?: number;
  delay?: number;
  hero?: boolean;                 // aurora border + stronger glow
  exit?: { start: number; duration?: number };
  className?: string;
  style?: React.CSSProperties;
}

export const GlassCard: React.FC<Props> = ({
  children,
  width,
  height,
  padding = 32,
  radius = 28,
  delay = 0,
  hero = false,
  exit,
  className,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Entry (scale + opacity) via spring
  const entryScale = sp({
    frame, fps, delay,
    preset: 'soft',
    clamp: true,
  });
  const entryOpacity = interpolate(frame - delay, [0, 12], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    easing: EASING.outExpo,
  });

  // Optional exit
  let exitOpacity = 1;
  let exitY = 0;
  if (exit) {
    const e = frame - exit.start;
    const d = exit.duration ?? 20;
    exitOpacity = interpolate(e, [0, d], [1, 0], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
      easing: EASING.outExpo,
    });
    exitY = interpolate(e, [0, d], [0, -24], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
      easing: EASING.outExpo,
    });
  }

  // Aurora border rotation (hero only)
  const borderAngle = (frame / fps) * 60;

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width,
        height,
        padding,
        borderRadius: radius,
        opacity: entryOpacity * exitOpacity,
        transform: `scale(${entryScale}) translateY(${exitY}px)`,
        background: 'rgba(20, 30, 51, 0.55)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        backdropFilter: 'blur(24px) saturate(140%)',
        WebkitBackdropFilter: 'blur(24px) saturate(140%)',
        boxShadow:
          '0 24px 64px rgba(0, 0, 0, 0.45), ' +
          'inset 0 1px 0 rgba(255, 255, 255, 0.1), ' +
          'inset 0 -1px 0 rgba(0, 0, 0, 0.25)',
        ...style,
      }}
    >
      {/* Aurora border (hero only) */}
      {hero && (
        <div
          style={{
            position: 'absolute',
            inset: -2,
            borderRadius: radius + 2,
            padding: 2,
            background: `conic-gradient(from ${borderAngle}deg, #a78bfa, #22d3ee, #f472b6, #fbbf24, #a78bfa)`,
            WebkitMask:
              'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
            WebkitMaskComposite: 'xor',
            maskComposite: 'exclude',
            opacity: 0.65,
            pointerEvents: 'none',
          }}
        />
      )}
      {children}
    </div>
  );
};
