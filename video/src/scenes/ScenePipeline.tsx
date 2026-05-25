/**
 * Scene 4 — The pipeline (0:13 → 0:20)
 *
 * Visualises the 4-step < 400 ms pipeline with animated chips joined
 * by a pulsing stream of particles. Each chip (Listen → Transcribe →
 * Translate → Speak) enters in sequence, its glow intensifying while
 * the stream arrow travels from the previous chip.
 *
 * The bottom strip shows the latency budget adding up in real time:
 * 170 ms · +65 ms · +165 ms · =380 ms. The counter ticks as each
 * step lands.
 *
 * This is the single most technical shot of the whole video — the
 * goal is to make the audience *see* the speed.
 */
import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { AuroraBackground, GridOverlay } from '../components/AuroraBackground';
import { GlassCard } from '../components/GlassCard';
import { sp } from '../lib/spring';
import { BRAND, EASING } from '../lib/theme';
import { useT } from '../lib/i18n';

interface Step {
  label: string;
  tech: string;
  latencyMs: number;
  color: string;
  icon: string; // emoji fallback — replaced by SVG path below
}

const STEPS: Step[] = [
  { label: 'Listen',    tech: 'Local capture',      latencyMs: 20,  color: BRAND.cyan,   icon: 'mic'   },
  { label: 'Transcribe',tech: 'Whisper · Groq LPU', latencyMs: 170, color: BRAND.purple, icon: 'ear'   },
  { label: 'Translate', tech: 'Llama 3.1 · Groq',   latencyMs: 65,  color: BRAND.blue,   icon: 'lang'  },
  { label: 'Speak',     tech: 'Cartesia Sonic-2',   latencyMs: 125, color: BRAND.pink,   icon: 'speak' },
];

const TOTAL = STEPS.reduce((a, s) => a + s.latencyMs, 0); // 380 ms

export const ScenePipeline: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = useT();

  // Each step lands 50 frames apart, starting at frame 10.
  const stepStart = (i: number) => 10 + i * 50;

  // Running latency counter — interpolates through milestones.
  const milestones: number[] = [];
  let running = 0;
  for (let i = 0; i < STEPS.length; i++) {
    running += STEPS[i].latencyMs;
    milestones.push(running);
  }
  const counterFrames = STEPS.map((_, i) => stepStart(i) + 20);
  const countedLatency = Math.round(
    interpolate(
      frame,
      [10, ...counterFrames],
      [0, ...milestones],
      { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASING.outExpo }
    )
  );

  // Eyebrow fade
  const eyebrowOpacity = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' });

  const fadeOut = interpolate(frame, [durationInFrames - 18, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ opacity: fadeOut }}>
      <AuroraBackground intensity={0.85} variant="feature" />
      <GridOverlay opacity={0.16} />

      <div
        style={{
          position: 'absolute', top: 100, left: 0, right: 0, textAlign: 'center',
          opacity: eyebrowOpacity,
        }}
      >
        <div
          style={{
            display: 'inline-block',
            padding: '8px 18px',
            borderRadius: 999,
            background: 'rgba(167,139,250,0.16)',
            border: '1px solid rgba(167,139,250,0.4)',
            fontSize: 18,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: '#e9d5ff',
            fontWeight: 500,
          }}
        >
          {t.pipeline.eyebrow}
        </div>
        <div
          style={{
            marginTop: 18,
            fontFamily: 'var(--font-display)',
            fontSize: 78,
            fontWeight: 600,
            color: 'white',
            letterSpacing: '-0.03em',
          }}
        >
          {t.pipeline.title}
        </div>
      </div>

      {/* Pipeline row */}
      <div
        style={{
          position: 'absolute',
          top: 360,
          left: 0, right: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 24,
          padding: '0 80px',
        }}
      >
        {STEPS.map((step, i) => {
          const d = stepStart(i);
          const localizedLabel = t.pipeline.steps[i];
          const chipEntry = sp({ frame, fps, delay: d, preset: 'bouncy', clamp: true });
          const chipOpacity = interpolate(frame - d, [0, 14], [0, 1], {
            extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
          });

          // Connector between this chip and the next
          const connectorT = interpolate(frame - d - 18, [0, 28], [0, 1], {
            extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASING.outExpo,
          });

          return (
            <React.Fragment key={step.label}>
              <div
                style={{
                  transform: `scale(${chipEntry})`,
                  opacity: chipOpacity,
                }}
              >
                <GlassCard width={230} height={210} padding={22} radius={22} hero={i === 1}>
                  <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
                    <div
                      style={{
                        width: 48, height: 48, borderRadius: 14,
                        background: `${step.color}22`,
                        border: `1px solid ${step.color}66`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: `0 0 24px ${step.color}55`,
                      }}
                    >
                      <StepIcon kind={step.icon} color={step.color} />
                    </div>
                    <div>
                      <div style={{ fontSize: 13, color: BRAND.ink400, letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 600 }}>
                        {t.pipeline.stepPrefix} {i + 1}
                      </div>
                      <div style={{ marginTop: 4, fontSize: 26, fontWeight: 600, color: 'white', letterSpacing: '-0.02em' }}>
                        {localizedLabel}
                      </div>
                      <div style={{ marginTop: 4, fontSize: 14, color: BRAND.ink300 }}>
                        {step.tech}
                      </div>
                    </div>
                    <div
                      style={{
                        alignSelf: 'flex-start',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 22,
                        fontWeight: 600,
                        color: step.color,
                        background: `${step.color}15`,
                        border: `1px solid ${step.color}44`,
                        padding: '4px 10px',
                        borderRadius: 8,
                      }}
                    >
                      +{step.latencyMs} ms
                    </div>
                  </div>
                </GlassCard>
              </div>

              {i < STEPS.length - 1 && (
                <div
                  style={{
                    position: 'relative',
                    width: 80,
                    height: 6,
                    borderRadius: 999,
                    background: 'rgba(255,255,255,0.06)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: `${connectorT * 100}%`,
                      background: `linear-gradient(90deg, ${step.color}, ${STEPS[i + 1].color})`,
                      boxShadow: `0 0 14px ${step.color}88`,
                      transition: 'width 40ms linear',
                    }}
                  />
                  {/* Travelling dot */}
                  {connectorT > 0 && connectorT < 1 && (
                    <div
                      style={{
                        position: 'absolute',
                        left: `calc(${connectorT * 100}% - 6px)`,
                        top: '50%',
                        marginTop: -6,
                        width: 12, height: 12,
                        borderRadius: 999,
                        background: 'white',
                        boxShadow: `0 0 16px white, 0 0 32px ${step.color}`,
                      }}
                    />
                  )}
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Running latency totaliser */}
      <div
        style={{
          position: 'absolute',
          bottom: 130,
          left: 0, right: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 32,
        }}
      >
        <div style={{ fontSize: 22, letterSpacing: '0.15em', textTransform: 'uppercase', color: BRAND.ink300, fontWeight: 500 }}>
          {t.pipeline.totalLabel}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 112,
            fontWeight: 700,
            background: 'linear-gradient(90deg, #a78bfa, #22d3ee, #f472b6)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
            letterSpacing: '-0.02em',
            lineHeight: 1,
          }}
        >
          {countedLatency} ms
        </div>
      </div>
    </AbsoluteFill>
  );
};

function StepIcon({ kind, color }: { kind: string; color: string }) {
  const common = { stroke: color, strokeWidth: 2, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  return (
    <svg viewBox="0 0 24 24" width={24} height={24}>
      {kind === 'mic' && (
        <>
          <rect x="9" y="3" width="6" height="12" rx="3" {...common} />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" {...common} />
        </>
      )}
      {kind === 'ear' && (
        <>
          <path d="M6 10a6 6 0 1 1 12 0c0 2-1 3-2 4s-2 2-2 4a3 3 0 1 1-6 0" {...common} />
        </>
      )}
      {kind === 'lang' && (
        <>
          <path d="M4 7h10M9 4v3m-2 0c0 4-3 8-3 8m3-4s3 4 7 4" {...common} />
          <path d="M13 18l4-8 4 8M14.5 15h5" {...common} />
        </>
      )}
      {kind === 'speak' && (
        <>
          <path d="M4 12h3l4-4v8l-4-4M15 8a5 5 0 0 1 0 8M18 5a9 9 0 0 1 0 14" {...common} />
        </>
      )}
    </svg>
  );
}
