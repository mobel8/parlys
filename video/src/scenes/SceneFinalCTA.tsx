/**
 * Scene 10 — Final CTA (0:54 → 1:00)
 *
 * The closing shot. The logo re-enters centre, the payoff tagline
 * lands above it, and the URL `voiceink.app` types in under it with
 * a pulsing aurora outline around a giant Download button.
 *
 * Motion script:
 *   0 →  12  Aurora intensifies
 *  12 →  40  Logo drops in, scales up with spring
 *  40 →  90  Headline reveals word by word
 *  90 → 170  Button scales in with a breathing glow ring
 * 150 → 230  URL types out
 * 300 → 360  Scene fades to a soft blue-black closing title card
 */
import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { AuroraBackground } from '../components/AuroraBackground';
import { VoiceInkLogo } from '../components/VoiceInkLogo';
import { StaggerText, TypingText } from '../components/TypingText';
import { GradientText } from '../components/GradientText';
import { sp } from '../lib/spring';
import { BRAND, EASING } from '../lib/theme';
import { useT } from '../lib/i18n';

export const SceneFinalCTA: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = useT();

  const btnScale = sp({ frame, fps, delay: 90, preset: 'bouncy', clamp: true });
  const btnOpacity = interpolate(frame, [90, 115], [0, 1], { extrapolateRight: 'clamp' });

  // Breathing ring scale
  const ringBreath = 1 + Math.sin((frame / fps) * 2) * 0.04;
  const ringAlpha = 0.5 + Math.sin((frame / fps) * 2) * 0.2;

  const urlOpacity = interpolate(frame, [150, 170], [0, 1], { extrapolateRight: 'clamp' });

  // Final fade
  const sceneFade = interpolate(frame, [durationInFrames - 30, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ opacity: sceneFade }}>
      <AuroraBackground intensity={1} variant="hero" />

      <AbsoluteFill
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 32,
          padding: '0 120px',
        }}
      >
        <VoiceInkLogo size={200} delay={12} preset="dramatic" />

        <div
          style={{
            textAlign: 'center',
            fontFamily: 'var(--font-display)',
            fontSize: 98,
            fontWeight: 600,
            letterSpacing: '-0.035em',
            color: 'white',
            lineHeight: 1.05,
          }}
        >
          <StaggerText text={t.cta.title} delay={40} staggerPerWord={4} />
        </div>

        <div
          style={{
            fontSize: 26,
            color: BRAND.ink300,
            fontWeight: 500,
            textAlign: 'center',
            opacity: interpolate(frame, [70, 95], [0, 1], { extrapolateRight: 'clamp' }),
          }}
        >
          {t.cta.sub} <span style={{ color: 'white' }}>{t.cta.subStrong}</span>
        </div>

        {/* Download button with breathing aurora ring */}
        <div
          style={{
            position: 'relative',
            marginTop: 12,
            opacity: btnOpacity,
            transform: `scale(${btnScale})`,
          }}
        >
          {/* Glow ring */}
          <div
            style={{
              position: 'absolute',
              inset: -18,
              borderRadius: 999,
              background: 'conic-gradient(from 0deg, #a78bfa, #22d3ee, #f472b6, #fbbf24, #a78bfa)',
              filter: 'blur(20px)',
              opacity: ringAlpha,
              transform: `scale(${ringBreath})`,
            }}
          />
          <div
            style={{
              position: 'relative',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 18,
              padding: '22px 48px',
              borderRadius: 999,
              background: 'linear-gradient(135deg, #a78bfa 0%, #d946ef 45%, #f472b6 100%)',
              color: 'white',
              fontFamily: 'var(--font-display)',
              fontSize: 36,
              fontWeight: 600,
              letterSpacing: '-0.01em',
              boxShadow:
                '0 20px 48px rgba(167,139,250,0.55), ' +
                'inset 0 2px 0 rgba(255,255,255,0.25), ' +
                'inset 0 -3px 0 rgba(0,0,0,0.15)',
            }}
          >
            <DownloadIcon />
            {t.cta.button}
          </div>
        </div>

        {/* URL */}
        <div
          style={{
            marginTop: 8,
            opacity: urlOpacity,
            fontFamily: 'var(--font-mono)',
            fontSize: 36,
            letterSpacing: '0.02em',
            color: 'white',
          }}
        >
          <GradientText variant="accent" speed={0.18}>
            <TypingText text={t.cta.url} delay={150} charsPerFrame={1.4} cursor cursorColor={BRAND.cyan} />
          </GradientText>
        </div>

        <div
          style={{
            marginTop: 20,
            fontSize: 18,
            color: BRAND.ink400,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            fontWeight: 500,
            opacity: interpolate(frame, [180, 210], [0, 1], { extrapolateRight: 'clamp' }),
          }}
        >
          {t.cta.footer}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const DownloadIcon = () => (
  <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </svg>
);
