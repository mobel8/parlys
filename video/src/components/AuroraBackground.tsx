/**
 * AuroraBackground — the base layer for every scene.
 *
 * Three enormous radial-gradient blobs drift independently across
 * the viewport. Each blob has its own phase offset and drift
 * vector, so the composition never looks still but also never
 * calls attention to itself.
 *
 * The `intensity` prop scales all blobs up/down at once — we turn
 * it up slightly during dense scenes (pricing, stats) to refresh
 * the eye, and down during text-heavy scenes so copy stays readable.
 */
import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { BRAND } from '../lib/theme';

interface Props {
  intensity?: number;  // 0.0-1.0, default 1
  variant?: 'hero' | 'feature' | 'calm';
}

export const AuroraBackground: React.FC<Props> = ({
  intensity = 1,
  variant = 'hero',
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps; // seconds

  // Per-variant blob palette. Feature scenes use cooler tones,
  // hero scenes splash warmer pinks and ambers.
  const blobs =
    variant === 'hero'
      ? [
          { color: BRAND.purple, base: { x: 0.15, y: 0.15 }, size: 0.9, phase: 0.0 },
          { color: BRAND.cyan,   base: { x: 0.85, y: 0.25 }, size: 0.8, phase: 2.3 },
          { color: BRAND.pink,   base: { x: 0.40, y: 0.85 }, size: 0.7, phase: 4.1 },
          { color: BRAND.amber,  base: { x: 0.80, y: 0.80 }, size: 0.6, phase: 1.7 },
        ]
      : variant === 'feature'
      ? [
          { color: BRAND.purple, base: { x: 0.20, y: 0.25 }, size: 0.75, phase: 0.0 },
          { color: BRAND.cyan,   base: { x: 0.85, y: 0.75 }, size: 0.70, phase: 3.1 },
          { color: BRAND.blue,   base: { x: 0.50, y: 0.50 }, size: 0.55, phase: 1.5 },
        ]
      : [
          { color: BRAND.purple, base: { x: 0.30, y: 0.40 }, size: 0.65, phase: 0.0 },
          { color: BRAND.blue,   base: { x: 0.75, y: 0.60 }, size: 0.55, phase: 2.8 },
        ];

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{ background: `radial-gradient(ellipse at 50% 50%, ${BRAND.ink900}, ${BRAND.ink950} 70%)` }}
    >
      {blobs.map((b, i) => {
        // Each blob drifts in a circular pattern with a unique phase.
        const driftX = Math.sin(t * 0.18 + b.phase) * 0.06;
        const driftY = Math.cos(t * 0.14 + b.phase) * 0.05;
        // Slow breathing scale — keeps the scene alive on static frames.
        const breath = 1 + Math.sin(t * 0.25 + b.phase) * 0.08;

        const px = (b.base.x + driftX) * width;
        const py = (b.base.y + driftY) * height;
        const size = b.size * Math.min(width, height) * 1.4 * breath;

        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: px - size / 2,
              top: py - size / 2,
              width: size,
              height: size,
              background: `radial-gradient(circle, ${b.color}cc 0%, ${b.color}00 65%)`,
              filter: 'blur(100px)',
              opacity: 0.7 * intensity,
              mixBlendMode: 'screen',
              willChange: 'transform',
            }}
          />
        );
      })}

      {/* Grain overlay — breaks gradient banding on bright screens. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.95' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.6 0 0 0 0 0.5 0 0 0 0 0.9 0 0 0 0.3 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          opacity: 0.35,
          mixBlendMode: 'overlay',
        }}
      />

      {/* Vignette */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(ellipse at center, transparent 40%, rgba(2,4,16,0.55) 100%)',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
};

/**
 * A light grid pattern used under product shots.
 * Reads as "technical" without stealing attention.
 */
export const GridOverlay: React.FC<{ opacity?: number }> = ({ opacity = 0.12 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // Subtle drift, 1 px every 8 frames — barely-noticeable life.
  const offset = (frame / fps) * 6;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        backgroundImage:
          'linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px),' +
          'linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)',
        backgroundSize: '96px 96px',
        backgroundPosition: `${offset}px ${offset}px`,
        opacity,
        maskImage:
          'radial-gradient(ellipse at center, black 30%, transparent 75%)',
        WebkitMaskImage:
          'radial-gradient(ellipse at center, black 30%, transparent 75%)',
        pointerEvents: 'none',
      }}
    />
  );
};
