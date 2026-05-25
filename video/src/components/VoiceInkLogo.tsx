/**
 * VoiceInkLogo — the "V" mark, reusable at any size.
 *
 * Composition:
 *   - Rounded square base (gradient, spring-scaled on mount)
 *   - Inset V shape (SVG path, dash-drawn on mount)
 *   - Radial glow behind (breathing)
 *   - Optional shimmering light sweep across the surface
 *
 * Props let scenes control entry animation independently — so the
 * hero scene can do a slow cinematic reveal while the CTA scene uses
 * a snappier version of the same mark.
 */
import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { sp } from '../lib/spring';
import { BRAND, GRADIENTS, EASING } from '../lib/theme';

interface Props {
  size?: number;        // pixels
  delay?: number;       // entry delay in frames
  preset?: 'dramatic' | 'subtle';
  glow?: boolean;
}

export const VoiceInkLogo: React.FC<Props> = ({
  size = 240,
  delay = 0,
  preset = 'dramatic',
  glow = true,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Entry animation — spring-scaled with slight overshoot.
  const scale = sp({
    frame, fps,
    delay,
    preset: preset === 'dramatic' ? 'bouncy' : 'soft',
    clamp: preset === 'subtle',
  });
  const opacity = interpolate(frame - delay, [0, 10], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASING.outExpo,
  });

  // Shimmer sweep — starts 20 frames after the mark lands.
  const shimmerT = interpolate(
    frame - delay - 20,
    [0, 40],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  // Breathing glow — perpetual.
  const breathScale = 1 + Math.sin((frame / fps) * 1.8) * 0.12;
  const breathAlpha = 0.55 + Math.sin((frame / fps) * 1.8) * 0.15;

  // The V is drawn with a clip-path path string. Stroke dash animates in.
  const pathLength = 1;
  const pathReveal = interpolate(
    frame - delay - 5,
    [0, 25],
    [0, pathLength],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASING.outExpo }
  );

  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        opacity,
        transform: `scale(${scale})`,
      }}
    >
      {/* Background glow */}
      {glow && (
        <div
          style={{
            position: 'absolute',
            inset: -size * 0.6,
            background: `radial-gradient(circle, ${BRAND.purple}70 0%, ${BRAND.pink}44 40%, transparent 70%)`,
            filter: 'blur(50px)',
            opacity: breathAlpha,
            transform: `scale(${breathScale})`,
          }}
        />
      )}

      {/* Gradient base */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: size * 0.22,
          background: GRADIENTS.brandMark,
          boxShadow:
            `inset 0 ${size * 0.02}px 0 rgba(255,255,255,0.2), ` +
            `inset 0 -${size * 0.04}px ${size * 0.08}px rgba(0,0,0,0.25), ` +
            `0 ${size * 0.06}px ${size * 0.18}px rgba(167,139,250,0.5)`,
        }}
      />

      {/* Glass highlight — thin elliptical shine on top third */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: size * 0.22,
          background:
            'linear-gradient(180deg, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0) 45%)',
          pointerEvents: 'none',
        }}
      />

      {/* Shimmer light sweep — diagonal slash */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: size * 0.22,
          background:
            'linear-gradient(110deg, transparent 40%, rgba(255,255,255,0.45) 50%, transparent 60%)',
          backgroundSize: '200% 200%',
          backgroundPosition: `${100 - shimmerT * 200}% 50%`,
          mixBlendMode: 'overlay',
          pointerEvents: 'none',
        }}
      />

      {/* V shape drawn with SVG path — stroke dashed to animate in. */}
      <svg
        viewBox="0 0 100 100"
        width="100%"
        height="100%"
        style={{ position: 'absolute', inset: 0 }}
      >
        <defs>
          <filter id={`glow-${size}`}>
            <feGaussianBlur stdDeviation="1.2" />
            <feComponentTransfer>
              <feFuncA type="linear" slope="1.4" />
            </feComponentTransfer>
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <path
          d="M 25 28 L 50 72 L 75 28"
          fill="none"
          stroke="white"
          strokeWidth="9"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={pathLength}
          strokeDasharray={pathLength}
          strokeDashoffset={pathLength * (1 - pathReveal)}
          filter={`url(#glow-${size})`}
        />
      </svg>
    </div>
  );
};
