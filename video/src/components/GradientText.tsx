/**
 * GradientText — the shimmering brand-gradient headline treatment.
 *
 * Animates the background-position so the gradient slowly drifts
 * across the text, producing an "aurora" effect that reads as
 * premium and alive. Used exclusively on emphasis words inside
 * long headlines (e.g. the "understands" in "The world understands").
 */
import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { GRADIENTS } from '../lib/theme';

interface Props {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  variant?: 'aurora' | 'accent';
  speed?: number; // cycles per 60 frames
}

export const GradientText: React.FC<Props> = ({
  children,
  className,
  style,
  variant = 'aurora',
  speed = 0.08,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // Position drifts 0 → 200 % over time; with 200 % size, this means
  // one full loop per 1/speed seconds.
  const pos = ((frame / fps) * speed * 200) % 200;

  return (
    <span
      className={className}
      style={{
        background: variant === 'aurora' ? GRADIENTS.aurora : GRADIENTS.accent,
        backgroundSize: '200% auto',
        backgroundPosition: `${pos}% 50%`,
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent',
        WebkitTextFillColor: 'transparent',
        ...style,
      }}
    >
      {children}
    </span>
  );
};
