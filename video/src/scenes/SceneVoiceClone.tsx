/**
 * Scene 6 — Voice cloning (0:28 → 0:35)
 *
 * Centerpiece: a glowing avatar node with 12 language flags orbiting
 * around it. Lines connect the core to each orbit, pulsing outward
 * like a radio transmission. Every flag enters on its own spring,
 * and the core gently breathes with its aurora aura.
 *
 * On the sides:
 *   - Left strip: "Your voice" spectrogram (high, bright bars).
 *   - Right strip: "In Japanese", "In Spanish", "In Arabic" mini-bars
 *     that animate in sequence, suggesting the same timbre is being
 *     reused in new languages.
 */
import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { AuroraBackground } from '../components/AuroraBackground';
import { GlassCard } from '../components/GlassCard';
import { Waveform } from '../components/Waveform';
import { sp } from '../lib/spring';
import { BRAND, EASING } from '../lib/theme';
import { useT } from '../lib/i18n';

// 12 flags — 360°/12 = 30° apart.
const FLAGS = [
  '🇫🇷', '🇪🇸', '🇵🇹', '🇩🇪', '🇮🇹', '🇳🇱',
  '🇯🇵', '🇰🇷', '🇨🇳', '🇸🇦', '🇮🇳', '🇬🇧',
];

export const SceneVoiceClone: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const t = useT();

  const eyebrow = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' });

  // Orbit entry staggered, then slow continuous rotation
  const rotation = (frame / fps) * 12; // deg/sec
  const orbitRadius = 260;
  const cx = width / 2;
  const cy = height / 2 + 20;

  const fadeOut = interpolate(frame, [durationInFrames - 18, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Core node entry
  const coreScale = sp({ frame, fps, delay: 10, preset: 'bouncy', clamp: true });

  // Pulse ring — one ring emitted every 45 frames
  const pulseCycle = (frame % 45) / 45;
  const pulseRadius = interpolate(pulseCycle, [0, 1], [0, orbitRadius + 40]);
  const pulseAlpha = interpolate(pulseCycle, [0, 1], [0.6, 0]);

  // Mini-clones strip (right side)
  const cloneLangs = ['Japanese', 'Spanish', 'Arabic', 'Hindi', 'Korean'];

  return (
    <AbsoluteFill style={{ opacity: fadeOut }}>
      <AuroraBackground intensity={0.9} variant="hero" />

      <div style={{ position: 'absolute', top: 80, left: 0, right: 0, textAlign: 'center', opacity: eyebrow }}>
        <div
          style={{
            display: 'inline-block',
            padding: '8px 18px',
            borderRadius: 999,
            background: 'rgba(244,114,182,0.16)',
            border: '1px solid rgba(244,114,182,0.4)',
            fontSize: 18,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: '#fce7f3',
            fontWeight: 500,
          }}
        >
          {t.clone.eyebrow}
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
          {t.clone.title1}
          <span
            style={{
              marginLeft: 16,
              background: 'linear-gradient(90deg, #a78bfa, #f472b6, #fbbf24)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            {t.clone.title2}
          </span>
        </div>
      </div>

      {/* Orbit centre */}
      <AbsoluteFill>
        {/* Emission rings — 3 staggered by 15 frames each */}
        {[0, 15, 30].map((o) => {
          const cycle = ((frame + o) % 45) / 45;
          const r = interpolate(cycle, [0, 1], [0, orbitRadius + 60]);
          const a = interpolate(cycle, [0, 1], [0.55, 0]);
          return (
            <div
              key={o}
              style={{
                position: 'absolute',
                left: cx - r,
                top: cy - r,
                width: r * 2,
                height: r * 2,
                borderRadius: '50%',
                border: `2px solid ${BRAND.purple}${Math.round(a * 255).toString(16).padStart(2, '0')}`,
                boxShadow: `0 0 ${r * 0.3}px ${BRAND.purple}22`,
              }}
            />
          );
        })}

        {/* Connector lines from core to each flag */}
        <svg
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          width={width}
          height={height}
        >
          <defs>
            <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
            </radialGradient>
          </defs>
          {FLAGS.map((_, i) => {
            const delayFrames = 30 + i * 3;
            const t = interpolate(frame - delayFrames, [0, 18], [0, 1], {
              extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASING.outExpo,
            });
            const angleDeg = (i * 360) / FLAGS.length + rotation;
            const angle = (angleDeg * Math.PI) / 180;
            const x = cx + orbitRadius * t * Math.cos(angle);
            const y = cy + orbitRadius * t * Math.sin(angle);
            return (
              <line
                key={i}
                x1={cx}
                y1={cy}
                x2={x}
                y2={y}
                stroke={BRAND.purple}
                strokeOpacity={0.25 * t}
                strokeWidth={1.5}
              />
            );
          })}
        </svg>

        {/* Core avatar */}
        <div
          style={{
            position: 'absolute',
            left: cx - 110,
            top: cy - 110,
            width: 220,
            height: 220,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #a78bfa, #f472b6 45%, #22d3ee)',
            transform: `scale(${coreScale})`,
            boxShadow: '0 0 80px rgba(167,139,250,0.75), inset 0 4px 0 rgba(255,255,255,0.25), inset 0 -8px 20px rgba(0,0,0,0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: 130,
              height: 130,
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(255,255,255,0.9), rgba(255,255,255,0.15))',
              filter: 'blur(1px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: 56,
              color: '#1a1b4b',
            }}
          >
            V
          </div>
        </div>

        {/* Flags */}
        {FLAGS.map((flag, i) => {
          const delayFrames = 30 + i * 3;
          const t = interpolate(frame - delayFrames, [0, 18], [0, 1], {
            extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASING.outExpo,
          });
          const angleDeg = (i * 360) / FLAGS.length + rotation;
          const angle = (angleDeg * Math.PI) / 180;
          const x = cx + orbitRadius * t * Math.cos(angle);
          const y = cy + orbitRadius * t * Math.sin(angle);
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: x - 32,
                top: y - 32,
                width: 64, height: 64,
                borderRadius: '50%',
                background: 'rgba(20, 30, 51, 0.7)',
                border: '1px solid rgba(255,255,255,0.2)',
                backdropFilter: 'blur(12px)',
                boxShadow: `0 8px 20px rgba(0,0,0,0.4), 0 0 24px ${BRAND.purple}33`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 34,
                opacity: t,
                transform: `scale(${t})`,
              }}
            >
              {flag}
            </div>
          );
        })}
      </AbsoluteFill>

      {/* Bottom caption */}
      <div
        style={{
          position: 'absolute',
          bottom: 60,
          left: 0, right: 0,
          textAlign: 'center',
          opacity: interpolate(frame, [90, 120], [0, 1], { extrapolateRight: 'clamp' }),
        }}
      >
        <div style={{ fontSize: 22, color: BRAND.ink300, letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 500 }}>
          {t.clone.caption1} ·&nbsp;
          <span style={{ color: 'white' }}>{t.clone.caption2}</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
