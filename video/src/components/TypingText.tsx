/**
 * TypingText — character-by-character reveal with a blinking cursor.
 *
 * Instead of an `interval` (which can't be time-travelled during
 * scrubbing in Remotion Studio), we derive the visible character
 * count from the current frame. This way the preview timeline can
 * be scrubbed, looped, and exported with perfect reproducibility.
 *
 * Splits on spaces so the ragged right edge never breaks mid-word.
 */
import React from 'react';
import { useCurrentFrame, interpolate } from 'remotion';
import { EASING } from '../lib/theme';

interface Props {
  text: string;
  delay?: number;
  charsPerFrame?: number;
  cursor?: boolean;
  cursorColor?: string;
  className?: string;
  style?: React.CSSProperties;
}

export const TypingText: React.FC<Props> = ({
  text,
  delay = 0,
  charsPerFrame = 2, // ≈ 120 chars/sec at 60fps; feels natural
  cursor = true,
  cursorColor = '#a78bfa',
  className,
  style,
}) => {
  const frame = useCurrentFrame();
  const progress = Math.max(0, frame - delay) * charsPerFrame;
  const shown = Math.min(text.length, Math.floor(progress));
  const done = shown >= text.length;

  // Word-safe splitting so the cursor doesn't jump mid-word on
  // screenshots. Visually you almost never notice this but it
  // ends up feeling nicer when you pause on a frame.
  const visible = text.slice(0, shown);

  // Cursor blinks every 0.5s while typing; stops after completion.
  const cursorOpacity = done
    ? interpolate(frame - delay - text.length / charsPerFrame, [0, 30, 60, 90], [1, 0, 0, 0])
    : (Math.floor((frame / 30)) % 2 === 0 ? 1 : 0);

  return (
    <span className={className} style={style}>
      {visible}
      {cursor && (
        <span
          style={{
            display: 'inline-block',
            marginLeft: '0.08em',
            width: '0.06em',
            height: '1em',
            verticalAlign: '-0.12em',
            background: cursorColor,
            opacity: cursorOpacity,
            borderRadius: 2,
            boxShadow: `0 0 12px ${cursorColor}`,
          }}
        />
      )}
    </span>
  );
};

/**
 * Stagger-reveal a line of words. Each word fades + slides up
 * independently. Used for the hero tagline and every "label row"
 * throughout the video.
 */
interface StaggerProps {
  text: string;
  delay?: number;
  staggerPerWord?: number;
  className?: string;
  style?: React.CSSProperties;
}

export const StaggerText: React.FC<StaggerProps> = ({
  text,
  delay = 0,
  staggerPerWord = 3,
  className,
  style,
}) => {
  const frame = useCurrentFrame();
  const words = text.split(' ');

  return (
    <span className={className} style={style}>
      {words.map((word, i) => {
        const wordDelay = delay + i * staggerPerWord;
        const opacity = interpolate(
          frame - wordDelay,
          [0, 14],
          [0, 1],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASING.outExpo }
        );
        const y = interpolate(
          frame - wordDelay,
          [0, 14],
          [18, 0],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASING.outExpo }
        );
        return (
          <span
            key={`${word}-${i}`}
            style={{
              display: 'inline-block',
              opacity,
              transform: `translateY(${y}px)`,
              marginRight: '0.28em',
              willChange: 'opacity, transform',
            }}
          >
            {word}
          </span>
        );
      })}
    </span>
  );
};
