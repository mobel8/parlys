/**
 * Scene 5 — Live interpreter (0:20 → 0:28)
 *
 * The hero demo. A faux desktop window plays out a real-time
 * conversation: user speaks French, VoiceInk produces English in
 * the speaker's own voice. The viewer sees the stages light up and
 * the translated waveform burst out on the right.
 *
 * Staging (from frame 0):
 *   0 →  20  Window chrome + idle state fade in
 *   20 →  90  "Listening…" + French transcript types out
 *   90 → 120  "Interpreting…" spinner chip pulses
 *  120 → 230  English translation types out in the spoken panel
 *  130 → 260  Waveform bursts + "380 ms" badge lands
 *  360 → 380  Gentle scale-out before the cross-fade
 */
import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { AuroraBackground } from '../components/AuroraBackground';
import { GlassCard } from '../components/GlassCard';
import { Waveform } from '../components/Waveform';
import { TypingText } from '../components/TypingText';
import { sp } from '../lib/spring';
import { BRAND, EASING } from '../lib/theme';
import { useT } from '../lib/i18n';

export const SceneLiveInterpreter: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = useT();

  const headerOpacity = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' });
  const windowScale = sp({ frame, fps, delay: 6, preset: 'soft' });
  const windowOpacity = interpolate(frame, [6, 22], [0, 1], { extrapolateRight: 'clamp' });

  // Stage chips
  const listenActive = frame >= 20 && frame < 120;
  const interpActive = frame >= 90 && frame < 140;
  const speakActive  = frame >= 120 && frame < 320;

  // Trigger frame for the TTS burst waveform
  const burstTrigger = 130;

  // Latency badge reveal
  const badgeOpacity = interpolate(frame, [155, 180], [0, 1], { extrapolateRight: 'clamp' });
  const badgeY = interpolate(frame, [155, 180], [10, 0], { extrapolateRight: 'clamp', easing: EASING.outExpo });

  const sceneOpacity = interpolate(frame, [durationInFrames - 20, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ opacity: sceneOpacity }}>
      <AuroraBackground intensity={0.95} variant="hero" />

      {/* Section header */}
      <div style={{ position: 'absolute', top: 70, left: 0, right: 0, textAlign: 'center', opacity: headerOpacity }}>
        <div
          style={{
            display: 'inline-block',
            padding: '8px 18px',
            borderRadius: 999,
            background: 'rgba(34,211,238,0.14)',
            border: '1px solid rgba(34,211,238,0.4)',
            fontSize: 18,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: '#cffafe',
            fontWeight: 500,
          }}
        >
          {t.interpreter.eyebrow}
        </div>
        <div
          style={{
            marginTop: 14,
            fontFamily: 'var(--font-display)',
            fontSize: 70,
            fontWeight: 600,
            color: 'white',
            letterSpacing: '-0.03em',
          }}
        >
          {t.interpreter.title}
        </div>
      </div>

      {/* Desktop window */}
      <div
        style={{
          position: 'absolute',
          top: 270,
          left: 0, right: 0,
          display: 'flex',
          justifyContent: 'center',
          transform: `scale(${windowScale})`,
          transformOrigin: '50% 30%',
          opacity: windowOpacity,
        }}
      >
        <GlassCard width={1400} height={560} padding={0} radius={26} hero>
          {/* Title bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '16px 22px',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <span style={{ width: 13, height: 13, borderRadius: 999, background: '#ef4444' }} />
            <span style={{ width: 13, height: 13, borderRadius: 999, background: '#fbbf24' }} />
            <span style={{ width: 13, height: 13, borderRadius: 999, background: '#10b981' }} />
            <div
              style={{
                flex: 1,
                textAlign: 'center',
                fontSize: 14,
                color: BRAND.ink300,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                fontWeight: 500,
              }}
            >
              VoiceInk · Live interpreter
            </div>
            <StageChip label={t.interpreter.stages[0]} active={listenActive} done={!listenActive && frame >= 90}  color={BRAND.cyan} />
            <StageChip label={t.interpreter.stages[1]} active={interpActive} done={!interpActive && frame >= 140} color={BRAND.purple} />
            <StageChip label={t.interpreter.stages[2]} active={speakActive}  done={false}                         color={BRAND.pink} />
          </div>

          {/* Body — split columns */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 24,
              padding: 32,
              height: 'calc(100% - 68px)',
            }}
          >
            {/* Source panel */}
            <div
              style={{
                borderRadius: 22,
                padding: 26,
                background: 'rgba(34,211,238,0.05)',
                border: '1px solid rgba(34,211,238,0.20)',
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
              }}
            >
              <LabelRow flag="🇫🇷" lang="Français" hint={t.interpreter.heardLabel} color={BRAND.cyan} />
              <div
                style={{
                  fontSize: 32,
                  fontWeight: 500,
                  color: 'white',
                  lineHeight: 1.35,
                  flex: 1,
                  minHeight: 220,
                }}
              >
                <TypingText
                  text={t.interpreter.source}
                  delay={28}
                  charsPerFrame={1.5}
                  cursor
                  cursorColor={BRAND.cyan}
                />
              </div>
              <Waveform
                bars={36}
                width={600}
                height={56}
                mode="live"
                intensity={listenActive ? 1 : 0.25}
                colorStart={BRAND.cyan}
                colorEnd={BRAND.blue}
              />
            </div>

            {/* Output panel */}
            <div
              style={{
                borderRadius: 22,
                padding: 26,
                background: 'rgba(244,114,182,0.06)',
                border: '1px solid rgba(244,114,182,0.26)',
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
                position: 'relative',
              }}
            >
              <LabelRow flag="🇬🇧" lang="English" hint={t.interpreter.spokenLabel} color={BRAND.pink} />
              <div
                style={{
                  fontSize: 32,
                  fontWeight: 500,
                  color: 'white',
                  lineHeight: 1.35,
                  flex: 1,
                  minHeight: 220,
                }}
              >
                <TypingText
                  text={t.interpreter.target}
                  delay={130}
                  charsPerFrame={1.6}
                  cursor
                  cursorColor={BRAND.pink}
                />
              </div>
              <Waveform
                bars={36}
                width={600}
                height={56}
                mode="triggered"
                triggerFrame={burstTrigger}
                colorStart={BRAND.pink}
                colorEnd={BRAND.amber}
              />

              {/* Latency badge */}
              <div
                style={{
                  position: 'absolute',
                  top: 18,
                  right: 22,
                  opacity: badgeOpacity,
                  transform: `translateY(${badgeY}px)`,
                }}
              >
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 14px',
                    borderRadius: 999,
                    background: 'rgba(52,211,153,0.18)',
                    border: '1px solid rgba(52,211,153,0.45)',
                    color: '#d1fae5',
                    fontSize: 16,
                    fontWeight: 600,
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: '#34d399', boxShadow: '0 0 10px #34d399' }} />
                  {t.interpreter.latencyBadge}
                </div>
              </div>
            </div>
          </div>
        </GlassCard>
      </div>
    </AbsoluteFill>
  );
};

function StageChip({ label, active, done, color }: { label: string; active: boolean; done: boolean; color: string }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 14px',
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 600,
        color: active ? color : done ? BRAND.emerald : BRAND.ink400,
        background: active
          ? `${color}22`
          : done
          ? 'rgba(52,211,153,0.14)'
          : 'rgba(255,255,255,0.04)',
        border: `1px solid ${active ? `${color}66` : done ? 'rgba(52,211,153,0.35)' : 'rgba(255,255,255,0.08)'}`,
        transition: 'all 80ms linear',
      }}
    >
      <span
        style={{
          width: 6, height: 6, borderRadius: 999,
          background: active ? color : done ? BRAND.emerald : 'rgba(255,255,255,0.3)',
          boxShadow: active ? `0 0 10px ${color}` : 'none',
        }}
      />
      {label}
    </div>
  );
}

function LabelRow({ flag, lang, hint, color }: { flag: string; lang: string; hint: string; color: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 15,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        fontWeight: 600,
        color,
      }}
    >
      <span style={{ fontSize: 28 }}>{flag}</span>
      <span>{lang}</span>
      <span style={{ width: 4, height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.3)' }} />
      <span style={{ color: BRAND.ink400, fontWeight: 500 }}>{hint}</span>
    </div>
  );
}
