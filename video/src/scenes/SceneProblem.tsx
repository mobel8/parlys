/**
 * Scene 3 — The problem (0:08 → 0:13)
 *
 * Shows the *bad* user experience of existing tools so the viewer
 * feels the friction we're solving. Three mock UI cards (Google
 * Translate, Otter, Dragon) drift into view, each stamped with a
 * harsh red latency badge. Over them, a contrast card flashes in
 * showing VoiceInk's 380 ms — the visual payoff that sets up the
 * rest of the video.
 *
 * Motion grammar:
 *   - Enemy cards come in from bottom, each with a subtle tilt.
 *   - A "vs" slash wipes across the middle at the mid-point.
 *   - VoiceInk card springs in on top, scaled 1.1x with a glow.
 */
import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { AuroraBackground } from '../components/AuroraBackground';
import { GlassCard } from '../components/GlassCard';
import { sp } from '../lib/spring';
import { BRAND, EASING } from '../lib/theme';
import { useT } from '../lib/i18n';

interface CompetitorCardProps {
  name: string;
  latency: string;
  delay: number;
  tilt: number;
  iconColor: string;
}

const CompetitorCard: React.FC<CompetitorCardProps> = ({ name, latency, delay, tilt, iconColor }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entry = sp({ frame, fps, delay, preset: 'soft' });
  const opacity = interpolate(frame - delay, [0, 14], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASING.outExpo,
  });
  const y = interpolate(frame - delay, [0, 20], [60, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASING.outExpo,
  });

  return (
    <div
      style={{
        opacity,
        transform: `translateY(${y}px) scale(${entry}) rotate(${tilt}deg)`,
        transformOrigin: '50% 60%',
      }}
    >
      <GlassCard width={360} height={220} padding={28} radius={22}>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              style={{
                width: 44, height: 44, borderRadius: 12,
                background: iconColor,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 22, fontWeight: 700, color: 'white',
                boxShadow: `0 4px 16px ${iconColor}88`,
              }}
            >
              {name[0]}
            </div>
            <div style={{ fontSize: 24, fontWeight: 600, color: 'white' }}>{name}</div>
          </div>

          <div>
            <div style={{ fontSize: 14, color: BRAND.ink400, letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 500 }}>
              Voice-to-voice latency
            </div>
            <div
              style={{
                marginTop: 6,
                fontFamily: 'var(--font-mono)',
                fontSize: 44,
                fontWeight: 600,
                color: '#fb7185', // rose-400 — clearly negative
                lineHeight: 1,
              }}
            >
              {latency}
            </div>
          </div>
        </div>
      </GlassCard>
    </div>
  );
};

export const SceneProblem: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = useT();

  // "VS" slash wipes in at ~90f, then the VoiceInk hero card lands.
  const slashX = interpolate(frame, [80, 110], [-40, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASING.outExpo,
  });
  const slashOpacity = interpolate(frame, [80, 100, 240, 260], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // VoiceInk champion card
  const championEntry = sp({ frame, fps, delay: 130, preset: 'bouncy', clamp: false });
  const championClamp = Math.min(championEntry, 1.06);

  // Scene fade-out
  const fadeOut = interpolate(frame, [durationInFrames - 16, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ opacity: fadeOut }}>
      <AuroraBackground intensity={0.7} variant="calm" />

      {/* Section eyebrow */}
      <div
        style={{
          position: 'absolute',
          top: 90,
          left: 0, right: 0,
          textAlign: 'center',
          fontSize: 22,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color: BRAND.ink300,
          fontWeight: 500,
          opacity: interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' }),
        }}
      >
        {t.problem.eyebrow}
      </div>

      {/* Three competitor cards */}
      <div
        style={{
          position: 'absolute',
          top: 180,
          left: 0, right: 0,
          display: 'flex',
          justifyContent: 'center',
          gap: 40,
        }}
      >
        <CompetitorCard name="Google Translate" latency="1 800 ms" delay={10} tilt={-3} iconColor="#4285f4" />
        <CompetitorCard name="Dragon NaturallySpeaking" latency="820 ms" delay={30} tilt={0} iconColor="#e63946" />
        <CompetitorCard name="Otter.ai" latency="1 200 ms" delay={50} tilt={3} iconColor="#10b981" />
      </div>

      {/* Slash divider */}
      <div
        style={{
          position: 'absolute',
          top: 480,
          left: 0, right: 0,
          display: 'flex',
          justifyContent: 'center',
          opacity: slashOpacity,
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 88,
            fontWeight: 700,
            letterSpacing: '0.1em',
            background: 'linear-gradient(90deg, #f43f5e, #ef4444)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
            transform: `translateX(${slashX}px)`,
          }}
        >
          VS
        </div>
      </div>

      {/* VoiceInk hero result */}
      <div
        style={{
          position: 'absolute',
          top: 580,
          left: 0, right: 0,
          display: 'flex',
          justifyContent: 'center',
          transform: `scale(${championClamp})`,
          transformOrigin: '50% 50%',
        }}
      >
        <GlassCard width={620} height={260} padding={34} radius={28} hero delay={130}>
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div
                style={{
                  width: 56, height: 56, borderRadius: 14,
                  background: 'linear-gradient(135deg, #a78bfa, #f472b6, #22d3ee)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 28, fontWeight: 700, color: 'white',
                  boxShadow: '0 8px 28px rgba(167,139,250,0.6)',
                }}
              >
                V
              </div>
              <div>
                <div style={{ fontSize: 30, fontWeight: 600, color: 'white', lineHeight: 1 }}>{t.problem.championName}</div>
                <div style={{ marginTop: 4, fontSize: 17, color: BRAND.ink300 }}>{t.problem.championTagline}</div>
              </div>
            </div>
            <div>
              <div
                style={{
                  fontSize: 14,
                  color: BRAND.ink400,
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  fontWeight: 500,
                }}
              >
                {t.problem.latencyLabel}
              </div>
              <div
                style={{
                  marginTop: 6,
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 12,
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 72,
                    fontWeight: 700,
                    lineHeight: 1,
                    background: 'linear-gradient(90deg, #a78bfa, #22d3ee)',
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    color: 'transparent',
                  }}
                >
                  380 ms
                </span>
                <span
                  style={{
                    fontSize: 20, fontWeight: 500,
                    color: '#34d399',
                    background: 'rgba(52,211,153,0.15)',
                    padding: '4px 12px',
                    borderRadius: 999,
                    border: '1px solid rgba(52,211,153,0.35)',
                  }}
                >
                  {t.problem.badge}
                </span>
              </div>
            </div>
          </div>
        </GlassCard>
      </div>
    </AbsoluteFill>
  );
};
