/**
 * Scene 2 — Tagline (0:03 → 0:08)
 *
 * Three-line hero tagline with the middle line painted in the aurora
 * gradient. Each line enters on its own spring offset; the third line
 * ("Instantly.") carries a short waveform underneath — a tiny hint
 * at what the product does.
 *
 * Layout mimics the landing page's hero so marketing and video feel
 * like the same universe.
 */
import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { AuroraBackground, GridOverlay } from '../components/AuroraBackground';
import { StaggerText } from '../components/TypingText';
import { GradientText } from '../components/GradientText';
import { Waveform } from '../components/Waveform';
import { BRAND, EASING } from '../lib/theme';
import { useT } from '../lib/i18n';

export const SceneTagline: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const t = useT();

  // Three lines stagger.
  const line1Opacity = interpolate(frame, [4, 20], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const line2Opacity = interpolate(frame, [40, 60], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const line3Opacity = interpolate(frame, [100, 125], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  const wavePulse = interpolate(frame, [140, 190], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASING.outExpo,
  });

  // End fade
  const fadeOut = interpolate(frame, [durationInFrames - 14, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ opacity: fadeOut }}>
      <AuroraBackground intensity={0.95} variant="hero" />
      <GridOverlay opacity={0.08} />

      <AbsoluteFill
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 160px',
          textAlign: 'center',
        }}
      >
        {/* Line 1 */}
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 140,
            fontWeight: 600,
            color: 'white',
            letterSpacing: '-0.04em',
            lineHeight: 1.05,
            opacity: line1Opacity,
          }}
        >
          <StaggerText text={t.tagline.l1} delay={4} staggerPerWord={3} />
        </div>

        {/* Line 2 — gradient */}
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 140,
            fontWeight: 600,
            letterSpacing: '-0.04em',
            lineHeight: 1.05,
            opacity: line2Opacity,
          }}
        >
          <GradientText variant="aurora" speed={0.15}>
            <StaggerText text={t.tagline.l2} delay={40} staggerPerWord={3} />
          </GradientText>
        </div>

        {/* Line 3 */}
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 120,
            fontWeight: 600,
            color: BRAND.ink100,
            letterSpacing: '-0.035em',
            lineHeight: 1.05,
            marginTop: 8,
            opacity: line3Opacity,
          }}
        >
          <StaggerText text={t.tagline.l3} delay={100} staggerPerWord={4} />
        </div>

        {/* Waveform hint — reinforces "Instantly" */}
        <div
          style={{
            marginTop: 48,
            opacity: wavePulse,
            transform: `scale(${0.9 + wavePulse * 0.1})`,
          }}
        >
          <Waveform
            bars={36}
            width={520}
            height={80}
            mode="live"
            intensity={0.7}
            colorStart={BRAND.purple}
            colorEnd={BRAND.cyan}
          />
        </div>

        {/* Small sub-caption */}
        <div
          style={{
            marginTop: 22,
            fontSize: 22,
            color: BRAND.ink300,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            fontWeight: 500,
            opacity: wavePulse,
          }}
        >
          {t.tagline.sub}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
