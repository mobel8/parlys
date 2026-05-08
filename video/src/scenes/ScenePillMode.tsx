/**
 * Scene 7 — Pill mode (0:35 → 0:42)
 *
 * Shows the floating 176×52 px pill that the desktop app shrinks
 * into. We mock up a real-looking OS background (VS Code window +
 * Slack window stacked in the back) so the pill has somewhere to
 * *float above*, selling the "always on top, never in the way"
 * pitch.
 *
 * Pill animation:
 *   0 →  25  Pill scales in from the bottom-right corner of the screen
 *   25 →  60 "Listening…" label reveal + waveform activates
 *   60 → 120 Transcript preview types in above the pill
 *  120 → 180 Pill pulses once in the emerald "sent" state
 *  200 → 280 Pill shrinks back to idle, label resets
 */
import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { AuroraBackground } from '../components/AuroraBackground';
import { Waveform } from '../components/Waveform';
import { TypingText } from '../components/TypingText';
import { sp } from '../lib/spring';
import { BRAND, EASING } from '../lib/theme';
import { useT } from '../lib/i18n';

export const ScenePillMode: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = useT();

  const headerOpacity = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' });

  // Pill state
  const pillScale = sp({ frame, fps, delay: 12, preset: 'bouncy', clamp: true });
  const pillOpacity = interpolate(frame, [12, 30], [0, 1], { extrapolateRight: 'clamp' });

  // "Sent" state flash at frame 180
  const sentGlow = interpolate(frame, [180, 200, 240, 260], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  const fadeOut = interpolate(frame, [durationInFrames - 18, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ opacity: fadeOut }}>
      <AuroraBackground intensity={0.7} variant="calm" />

      <div style={{ position: 'absolute', top: 80, left: 0, right: 0, textAlign: 'center', opacity: headerOpacity }}>
        <div
          style={{
            display: 'inline-block',
            padding: '8px 18px',
            borderRadius: 999,
            background: 'rgba(96,165,250,0.16)',
            border: '1px solid rgba(96,165,250,0.4)',
            fontSize: 18,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: '#dbeafe',
            fontWeight: 500,
          }}
        >
          {t.pill.eyebrow}
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
          {t.pill.title}
        </div>
      </div>

      {/* Mock OS backdrop — 2 stacked faux windows */}
      <MockWindow
        top={260}
        left={160}
        width={900}
        height={540}
        title="Visual Studio Code — app.tsx"
        accent={BRAND.blue}
        contentColor="#1e1e1e"
        lines={[
          'import { useState } from "react";',
          '',
          'export function App() {',
          '  const [message, setMessage] = useState("");',
          '  return (',
          '    <div className="chat">',
          '      <input value={message} onChange={e => setMessage(e.target.value)} />',
          '      <button>Send</button>',
          '    </div>',
          '  );',
          '}',
        ]}
        delay={6}
      />

      <MockWindow
        top={420}
        left={860}
        width={860}
        height={460}
        title="Slack · #engineering"
        accent={BRAND.purple}
        contentColor="rgba(10, 17, 36, 0.95)"
        lines={[
          '@alice: do we have a ship date for the auth refactor?',
          '@bob: working on it right now — PR up in 10',
          '@me: let me dictate a quick summary for the team',
          '',
          '_you are typing…_',
          '',
          '',
        ]}
        delay={24}
        tilted
      />

      {/* Transcript preview bubble (above pill) */}
      <div
        style={{
          position: 'absolute',
          bottom: 190,
          right: 140,
          opacity: interpolate(frame, [60, 90], [0, 1], { extrapolateRight: 'clamp' }),
          transform: `translateY(${interpolate(frame, [60, 90], [14, 0], { extrapolateRight: 'clamp', easing: EASING.outExpo })}px)`,
        }}
      >
        <div
          style={{
            maxWidth: 420,
            padding: '14px 18px',
            borderRadius: 20,
            background: 'rgba(10, 17, 36, 0.85)',
            border: '1px solid rgba(255,255,255,0.12)',
            backdropFilter: 'blur(18px)',
            color: 'white',
            fontSize: 18,
            lineHeight: 1.4,
            boxShadow: '0 16px 40px rgba(0,0,0,0.5)',
          }}
        >
          <TypingText
            text={t.pill.transcript}
            delay={60}
            charsPerFrame={1.6}
            cursor={false}
          />
        </div>
        <div
          style={{
            marginLeft: 40,
            width: 16,
            height: 16,
            background: 'rgba(10, 17, 36, 0.85)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderTop: 'none',
            borderLeft: 'none',
            transform: 'rotate(45deg) translateY(-8px)',
            borderRadius: 2,
          }}
        />
      </div>

      {/* The pill itself — positioned bottom-right */}
      <div
        style={{
          position: 'absolute',
          bottom: 80,
          right: 120,
          opacity: pillOpacity,
          transform: `scale(${pillScale})`,
          transformOrigin: '100% 100%',
        }}
      >
        <div
          style={{
            position: 'relative',
            width: 352,    // 176 × 2 for hi-DPI crispness on 1080p
            height: 104,   // 52 × 2
            borderRadius: 52,
            background: 'rgba(10, 17, 36, 0.85)',
            border: '1px solid rgba(255,255,255,0.14)',
            backdropFilter: 'blur(24px) saturate(150%)',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '0 28px',
            boxShadow:
              '0 24px 64px rgba(0,0,0,0.55), ' +
              `0 0 ${40 + sentGlow * 40}px ${sentGlow > 0.1 ? `rgba(52,211,153,${sentGlow * 0.55})` : 'rgba(167,139,250,0.35)'}, ` +
              'inset 0 1px 0 rgba(255,255,255,0.14)',
            transition: 'box-shadow 80ms linear',
          }}
        >
          {/* Listening indicator */}
          <div style={{ position: 'relative', width: 18, height: 18 }}>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '50%',
                background: sentGlow > 0.3 ? BRAND.emerald : BRAND.pink,
                boxShadow: sentGlow > 0.3
                  ? '0 0 16px #34d399'
                  : '0 0 16px #f472b6',
                transition: 'background 80ms linear',
              }}
            />
            {/* ping */}
            <div
              style={{
                position: 'absolute',
                inset: -6,
                borderRadius: '50%',
                border: `2px solid ${sentGlow > 0.3 ? BRAND.emerald : BRAND.pink}`,
                opacity: interpolate((frame % 30) / 30, [0, 1], [0.7, 0]),
                transform: `scale(${interpolate((frame % 30) / 30, [0, 1], [0.8, 1.6])})`,
              }}
            />
          </div>

          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 600, color: 'white', lineHeight: 1 }}>
              {sentGlow > 0.3 ? t.pill.sent : t.pill.listening}
            </div>
            <div style={{ marginTop: 6, fontSize: 14, color: BRAND.ink300, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 500 }}>
              {t.pill.hotkey}
            </div>
          </div>

          <Waveform
            bars={14}
            width={90}
            height={40}
            mode="live"
            intensity={sentGlow > 0.3 ? 0.15 : 1}
            colorStart={BRAND.purple}
            colorEnd={BRAND.pink}
          />
        </div>

        <div
          style={{
            marginTop: 18,
            textAlign: 'right',
            fontSize: 14,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: BRAND.ink400,
            fontWeight: 500,
          }}
        >
          {t.pill.caption}
        </div>
      </div>
    </AbsoluteFill>
  );
};

interface MockWindowProps {
  top: number; left: number;
  width: number; height: number;
  title: string;
  accent: string;
  contentColor: string;
  lines: string[];
  delay: number;
  tilted?: boolean;
}

const MockWindow: React.FC<MockWindowProps> = ({
  top, left, width, height, title, accent, contentColor, lines, delay, tilted,
}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame - delay, [0, 20], [0, 0.95], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASING.outExpo,
  });
  const y = interpolate(frame - delay, [0, 24], [30, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASING.outExpo,
  });
  return (
    <div
      style={{
        position: 'absolute',
        top, left,
        width, height,
        borderRadius: 18,
        overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.12)',
        background: contentColor,
        opacity,
        transform: `translateY(${y}px) rotate(${tilted ? 1.5 : 0}deg)`,
        boxShadow: '0 40px 80px rgba(0,0,0,0.6), 0 0 80px rgba(0,0,0,0.25)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 16px',
          background: 'rgba(20, 30, 51, 0.85)',
          borderBottom: `1px solid ${accent}55`,
        }}
      >
        <span style={{ width: 11, height: 11, borderRadius: 999, background: '#ef4444' }} />
        <span style={{ width: 11, height: 11, borderRadius: 999, background: '#fbbf24' }} />
        <span style={{ width: 11, height: 11, borderRadius: 999, background: '#10b981' }} />
        <div style={{ flex: 1, textAlign: 'center', fontSize: 12, color: BRAND.ink300 }}>{title}</div>
      </div>
      <div style={{ padding: 20, fontFamily: 'var(--font-mono)', fontSize: 15, color: '#e5e7eb', lineHeight: 1.7 }}>
        {lines.map((l, i) => (
          <div key={i} style={{ opacity: l === '' ? 0 : 0.92, color: l.startsWith('@me') ? accent : '#e5e7eb' }}>
            {l || '\u00a0'}
          </div>
        ))}
      </div>
    </div>
  );
};
