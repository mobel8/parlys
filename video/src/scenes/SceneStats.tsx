/**
 * Scene 8 — Numbers (0:42 → 0:48)
 *
 * Four big stats, each with a counter that ticks from 0 to target
 * over ~45 frames. The layout is a 2×2 bento-style grid.
 *
 * Each tile shows:
 *   - Big number (mono, gradient fill)
 *   - Unit (small grey)
 *   - Label (medium grey)
 *   - Sparkline or mini-icon that matches the metric
 *
 * Decisions:
 *   - We use `Math.round` on the interpolated value (not `Math.floor`)
 *     so the counter lands exactly on the target at the final frame.
 *   - The 3rd tile (0 €) has no counter — a number that doesn't tick
 *     reinforces "already free".
 */
import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { AuroraBackground, GridOverlay } from '../components/AuroraBackground';
import { GlassCard } from '../components/GlassCard';
import { Waveform } from '../components/Waveform';
import { BRAND, EASING } from '../lib/theme';
import { useT } from '../lib/i18n';

interface Stat {
  target: number;
  unit: string;
  prefix?: string;
  tint: string;
  decimals?: number;
  noTick?: boolean;
  preset: 'waveform' | 'globe' | 'sparkle' | 'heart';
}

export const SceneStats: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = useT();

  const STATS: Stat[] = [
    { target: 380,    unit: 'ms',        tint: BRAND.purple, preset: 'waveform' },
    { target: 30,     unit: '+',         tint: BRAND.cyan,   preset: 'globe' },
    { target: 0,      unit: '€',         tint: BRAND.amber,  preset: 'sparkle', noTick: true, prefix: '' },
    { target: 12_400, unit: t.stats.users, tint: BRAND.pink, preset: 'heart' },
  ];

  const headerOpacity = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' });

  const fadeOut = interpolate(frame, [durationInFrames - 16, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ opacity: fadeOut }}>
      <AuroraBackground intensity={0.85} variant="hero" />
      <GridOverlay opacity={0.15} />

      <div style={{ position: 'absolute', top: 90, left: 0, right: 0, textAlign: 'center', opacity: headerOpacity }}>
        <div
          style={{
            display: 'inline-block',
            padding: '8px 18px',
            borderRadius: 999,
            background: 'rgba(251,191,36,0.14)',
            border: '1px solid rgba(251,191,36,0.4)',
            fontSize: 18,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: '#fef3c7',
            fontWeight: 500,
          }}
        >
          {t.stats.eyebrow}
        </div>
        <div
          style={{
            marginTop: 14,
            fontFamily: 'var(--font-display)',
            fontSize: 74,
            fontWeight: 600,
            color: 'white',
            letterSpacing: '-0.03em',
          }}
        >
          {t.stats.title1}
          <span
            style={{
              marginLeft: 14,
              background: 'linear-gradient(90deg, #fbbf24, #f472b6)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            {t.stats.title2}
          </span>
        </div>
      </div>

      {/* 2x2 grid */}
      <div
        style={{
          position: 'absolute',
          top: 320,
          left: 0, right: 0,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gridTemplateRows: '1fr 1fr',
          gap: 28,
          padding: '0 160px',
        }}
      >
        {STATS.map((s, i) => (
          <StatTile key={i} stat={s} label={t.stats.labels[i]} delay={10 + i * 20} frame={frame} fps={fps} />
        ))}
      </div>
    </AbsoluteFill>
  );
};

interface StatTileProps {
  stat: Stat;
  label: string;
  delay: number;
  frame: number;
  fps: number;
}

const StatTile: React.FC<StatTileProps> = ({ stat, label, delay, frame, fps }) => {
  const { target, unit, tint, decimals = 0, noTick, prefix = '', preset } = stat;

  // Counter interpolation over 45 frames
  const raw = interpolate(
    frame,
    [delay, delay + 45],
    [0, target],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASING.outExpo }
  );
  const value = noTick ? target : decimals === 0 ? Math.round(raw) : Number(raw.toFixed(decimals));

  return (
    <GlassCard padding={36} radius={28} delay={delay - 8}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between', minHeight: 220 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            fontFamily: 'var(--font-display)',
            fontSize: 120,
            fontWeight: 700,
            lineHeight: 1,
            letterSpacing: '-0.04em',
            color: 'transparent',
            background: `linear-gradient(135deg, ${tint}, #ffffff)`,
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
          }}
        >
          {prefix}{typeof value === 'number' && value >= 1000 ? value.toLocaleString('en-US') : value}
          <span style={{ fontSize: 48, color: tint, WebkitTextFillColor: tint }}>
            {unit}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end' }}>
          <div style={{ fontSize: 22, color: BRAND.ink200, maxWidth: '70%', lineHeight: 1.3, fontWeight: 500 }}>
            {label}
          </div>
          <StatIcon preset={preset} tint={tint} frame={frame} />
        </div>
      </div>
    </GlassCard>
  );
};

const StatIcon: React.FC<{ preset: Stat['preset']; tint: string; frame: number }> = ({ preset, tint, frame }) => {
  if (preset === 'waveform') {
    return <Waveform bars={14} width={140} height={56} mode="live" intensity={0.75} colorStart={tint} colorEnd="#ffffff" />;
  }
  if (preset === 'globe') {
    const rot = (frame / 2) % 360;
    return (
      <svg width={70} height={70} viewBox="0 0 48 48" style={{ transform: `rotate(${rot}deg)` }}>
        <circle cx="24" cy="24" r="20" fill="none" stroke={tint} strokeWidth="2" />
        <ellipse cx="24" cy="24" rx="8" ry="20" fill="none" stroke={tint} strokeWidth="1.2" />
        <ellipse cx="24" cy="24" rx="20" ry="8" fill="none" stroke={tint} strokeWidth="1.2" />
        <line x1="4" y1="24" x2="44" y2="24" stroke={tint} strokeWidth="1.2" />
      </svg>
    );
  }
  if (preset === 'sparkle') {
    return (
      <svg width={70} height={70} viewBox="0 0 48 48">
        <path
          d="M24 4 L28 20 L44 24 L28 28 L24 44 L20 28 L4 24 L20 20 Z"
          fill={tint}
          style={{ filter: `drop-shadow(0 0 12px ${tint})` }}
        />
      </svg>
    );
  }
  // heart
  return (
    <svg width={64} height={64} viewBox="0 0 48 48" style={{ transform: `scale(${1 + 0.1 * Math.sin(frame / 6)})` }}>
      <path
        d="M24 42s-14-8.5-14-20a8 8 0 0 1 14-5 8 8 0 0 1 14 5c0 11.5-14 20-14 20Z"
        fill={tint}
        style={{ filter: `drop-shadow(0 0 14px ${tint}88)` }}
      />
    </svg>
  );
};
