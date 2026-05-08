/**
 * Scene 1 — Logo intro (0:00 → 0:03)
 *
 * Opening shot. The studio is dark; an aurora ripple pulses once from
 * the centre and pushes the logo mark out of the void. Then the
 * wordmark "VoiceInk" slides in under it, and a tagline chip lands
 * below.
 *
 * Three simultaneous motions, each on its own spring:
 *   frame  0 → 10  : the viewport fades from pure black to the
 *                    animated aurora background.
 *   frame 12 → 40  : the V mark bouncy-springs in (scale + glow).
 *   frame 32 → 58  : the wordmark slides up from below.
 *   frame 55 → 72  : the "Desktop app for Windows · Free" pill fades in.
 *
 * The scene ends with a gentle push-in (1.00 → 1.04 scale over the
 * final 40 frames) that gives the handoff to Scene 2 some momentum.
 */
import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { AuroraBackground } from '../components/AuroraBackground';
import { VoiceInkLogo } from '../components/VoiceInkLogo';
import { StaggerText } from '../components/TypingText';
import { sp } from '../lib/spring';
import { EASING, BRAND } from '../lib/theme';
import { useT } from '../lib/i18n';

export const SceneIntroLogo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = useT();

  // Void → aurora fade
  const bgOpacity = interpolate(frame, [0, 12], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASING.outExpo,
  });

  // Wordmark slide
  const wmOpacity = interpolate(frame, [32, 50], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASING.outExpo,
  });
  const wmY = interpolate(frame, [32, 58], [40, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASING.outExpo,
  });

  // Pill badge
  const pillScale = sp({ frame, fps, delay: 55, preset: 'soft' });
  const pillOpacity = interpolate(frame, [55, 70], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Subtle zoom-in on the whole composition for the final 40 frames
  const zoom = interpolate(
    frame,
    [durationInFrames - 40, durationInFrames],
    [1, 1.04],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASING.outExpo }
  );

  // Overall fade-out in the last 10 frames for a clean cross-fade
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 10, durationInFrames],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: BRAND.ink950,
        opacity: fadeOut,
        transform: `scale(${zoom})`,
      }}
    >
      <AbsoluteFill style={{ opacity: bgOpacity }}>
        <AuroraBackground intensity={1} variant="hero" />
      </AbsoluteFill>

      {/* Centre column */}
      <AbsoluteFill
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 32,
        }}
      >
        <VoiceInkLogo size={280} delay={12} preset="dramatic" />

        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 120,
            fontWeight: 700,
            letterSpacing: '-0.04em',
            color: 'white',
            opacity: wmOpacity,
            transform: `translateY(${wmY}px)`,
            lineHeight: 1,
          }}
        >
          VoiceInk
        </div>

        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 20px',
            borderRadius: 999,
            background: 'rgba(167, 139, 250, 0.18)',
            border: '1px solid rgba(167, 139, 250, 0.45)',
            color: '#e9d5ff',
            fontSize: 22,
            fontWeight: 500,
            letterSpacing: '0.02em',
            opacity: pillOpacity,
            transform: `scale(${pillScale})`,
            backdropFilter: 'blur(8px)',
            boxShadow: '0 0 40px rgba(167,139,250,0.35)',
          }}
        >
          <span
            style={{
              width: 10, height: 10, borderRadius: 999,
              background: BRAND.pink,
              boxShadow: `0 0 16px ${BRAND.pink}`,
            }}
          />
          <StaggerText text={t.intro.pill} delay={58} staggerPerWord={2} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
