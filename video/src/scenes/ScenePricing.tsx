/**
 * Scene 9 — Pricing (0:48 → 0:54)
 *
 * Three plan cards slide up in sequence. The middle card ("Pro") is
 * highlighted from frame 0 — its aurora border is active, it sits
 * ~20 px taller, and has a "Most popular" pill. A gentle downward
 * "glow rain" of brand-colour dots falls behind the Pro card only.
 *
 * The closing line at the bottom picks up on the 9.90 €/mo number
 * and pushes it into the next scene.
 */
import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { AuroraBackground } from '../components/AuroraBackground';
import { GlassCard } from '../components/GlassCard';
import { sp } from '../lib/spring';
import { BRAND, EASING } from '../lib/theme';
import { useT } from '../lib/i18n';
import type { Strings } from '../lib/strings';

type PlanData = Strings['pricing']['plans'][number];

export const ScenePricing: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = useT();

  // Highlight the middle plan (Pro)
  const PLANS = t.pricing.plans.map((p, i) => ({ ...p, highlight: i === 1 }));

  const headerOpacity = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' });

  const fadeOut = interpolate(frame, [durationInFrames - 16, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ opacity: fadeOut }}>
      <AuroraBackground intensity={0.88} variant="hero" />

      <div style={{ position: 'absolute', top: 80, left: 0, right: 0, textAlign: 'center', opacity: headerOpacity }}>
        <div
          style={{
            display: 'inline-block',
            padding: '8px 18px',
            borderRadius: 999,
            background: 'rgba(244,114,182,0.14)',
            border: '1px solid rgba(244,114,182,0.4)',
            fontSize: 18,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: '#fce7f3',
            fontWeight: 500,
          }}
        >
          {t.pricing.eyebrow}
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
          {t.pricing.title1}
          <span
            style={{
              marginLeft: 14,
              background: 'linear-gradient(90deg, #a78bfa, #22d3ee)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            {t.pricing.title2}
          </span>
        </div>
      </div>

      {/* Plan cards */}
      <div
        style={{
          position: 'absolute',
          top: 300,
          left: 0, right: 0,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'end',
          gap: 28,
          padding: '0 120px',
        }}
      >
        {PLANS.map((plan, i) => (
          <PlanTile key={plan.name} plan={plan} popularLabel={t.pricing.popular} delay={20 + i * 22} frame={frame} fps={fps} />
        ))}
      </div>

      {/* Bottom caption */}
      <div
        style={{
          position: 'absolute',
          bottom: 80,
          left: 0, right: 0,
          textAlign: 'center',
          opacity: interpolate(frame, [120, 155], [0, 1], { extrapolateRight: 'clamp' }),
        }}
      >
        <div style={{ fontSize: 22, color: BRAND.ink300, fontWeight: 500 }}>
          {t.pricing.footnote} <span style={{ color: 'white' }}>{t.pricing.footnoteStrong}</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

interface PlanTileProps {
  plan: PlanData & { highlight?: boolean };
  popularLabel: string;
  delay: number;
  frame: number;
  fps: number;
}

const PlanTile: React.FC<PlanTileProps> = ({ plan, popularLabel, delay, frame, fps }) => {
  const y = interpolate(frame - delay, [0, 24], [60, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASING.outExpo,
  });
  const entry = sp({ frame, fps, delay, preset: 'soft' });

  return (
    <div
      style={{
        transform: `translateY(${y}px) scale(${entry})`,
        position: 'relative',
        width: plan.highlight ? 400 : 360,
      }}
    >
      {/* Glow rain behind pro */}
      {plan.highlight && <GlowRain delay={delay} />}

      {plan.highlight && (
        <div
          style={{
            position: 'absolute',
            top: -22,
            left: 0, right: 0,
            display: 'flex',
            justifyContent: 'center',
            zIndex: 2,
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '7px 16px',
              borderRadius: 999,
              background: 'linear-gradient(90deg, rgba(167,139,250,0.3), rgba(244,114,182,0.3))',
              border: '1px solid rgba(167,139,250,0.55)',
              color: '#e9d5ff',
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: '0.06em',
              backdropFilter: 'blur(8px)',
              boxShadow: '0 0 32px rgba(167,139,250,0.5)',
            }}
          >
            <span>✦</span> {popularLabel}
          </div>
        </div>
      )}

      <GlassCard
        width={plan.highlight ? 400 : 360}
        padding={32}
        radius={28}
        hero={plan.highlight}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minHeight: 460 }}>
          <div>
            <div style={{ fontSize: 26, fontWeight: 600, color: 'white' }}>{plan.name}</div>
            <div style={{ marginTop: 4, fontSize: 16, color: BRAND.ink400 }}>
              {plan.sub}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 90,
                fontWeight: 700,
                letterSpacing: '-0.04em',
                lineHeight: 1,
                color: 'transparent',
                background: plan.highlight
                  ? 'linear-gradient(135deg, #a78bfa, #f472b6, #fbbf24)'
                  : 'linear-gradient(135deg, #e8ecf5, #93a1bf)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
              }}
            >
              {plan.price}
            </span>
            <span style={{ fontSize: 18, color: BRAND.ink300 }}>{plan.unit}</span>
          </div>

          <div
            style={{
              padding: '12px 20px',
              borderRadius: 14,
              textAlign: 'center',
              fontSize: 17,
              fontWeight: 600,
              color: 'white',
              background: plan.highlight
                ? 'linear-gradient(135deg, #a78bfa, #f472b6)'
                : 'rgba(255,255,255,0.06)',
              border: plan.highlight ? 'none' : '1px solid rgba(255,255,255,0.1)',
              boxShadow: plan.highlight ? '0 12px 32px rgba(167,139,250,0.45)' : 'none',
            }}
          >
            {plan.cta}
          </div>

          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {plan.bullets.map((b) => (
              <li
                key={b}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: 17,
                  color: BRAND.ink100,
                }}
              >
                <span
                  style={{
                    width: 20, height: 20, borderRadius: 6,
                    background: plan.highlight ? 'rgba(167,139,250,0.25)' : 'rgba(255,255,255,0.08)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: plan.highlight ? '1px solid rgba(167,139,250,0.45)' : '1px solid rgba(255,255,255,0.12)',
                    flex: '0 0 auto',
                  }}
                >
                  <svg width={12} height={12} viewBox="0 0 12 12" fill="none" stroke={plan.highlight ? BRAND.purple : BRAND.emerald} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 6.5 5 9.5 10 3" />
                  </svg>
                </span>
                {b}
              </li>
            ))}
          </ul>
        </div>
      </GlassCard>
    </div>
  );
};

// Subtle "glow rain" — dots drop from the top of the Pro card.
const GlowRain: React.FC<{ delay: number }> = ({ delay }) => {
  const frame = useCurrentFrame();
  const N = 18;
  return (
    <div style={{ position: 'absolute', inset: -20, overflow: 'hidden', borderRadius: 28, pointerEvents: 'none' }}>
      {Array.from({ length: N }).map((_, i) => {
        const cycle = ((frame + i * 7 - delay) % 120) / 120;
        const y = interpolate(cycle, [0, 1], [-40, 520]);
        const x = ((i * 73) % 100);
        const alpha = interpolate(cycle, [0, 0.2, 0.8, 1], [0, 0.6, 0.6, 0]);
        const color = i % 3 === 0 ? '#a78bfa' : i % 3 === 1 ? '#f472b6' : '#22d3ee';
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${x}%`,
              top: y,
              width: 4,
              height: 4,
              borderRadius: 999,
              background: color,
              opacity: alpha,
              boxShadow: `0 0 8px ${color}`,
            }}
          />
        );
      })}
    </div>
  );
};
