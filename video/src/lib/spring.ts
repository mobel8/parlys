/**
 * Pre-configured spring presets.
 *
 * Remotion's spring() takes a physics config (mass, damping, stiffness).
 * Rather than sprinkling magic numbers through every scene, we
 * standardise on a palette of 4 springs so the whole video feels
 * consistent: the logo has the same "bounce" as a feature card, etc.
 */
import { spring, SpringConfig } from 'remotion';

export const SPRINGS: Record<string, Partial<SpringConfig>> = {
  // Default soft — used for every entrance unless noted.
  soft:  { damping: 22, mass: 1, stiffness: 130 },
  // Punchier — titles, stat numbers, logos.
  punch: { damping: 14, mass: 0.8, stiffness: 160 },
  // Slow reveal — for decorative background sweeps.
  slow:  { damping: 40, mass: 1.4, stiffness: 50 },
  // Overshoot — logo mark, hero reveals; pair with {clamp: false}.
  bouncy:{ damping: 10, mass: 0.8, stiffness: 180 },
};

/**
 * Convenience wrapper. Equivalent to:
 *   spring({ frame, fps, config, ...opts })
 * but with a shorter signature and `clamp: true` default.
 */
export function sp({
  frame,
  fps,
  preset = 'soft',
  clamp = true,
  delay = 0,
  durationInFrames,
}: {
  frame: number;
  fps: number;
  preset?: keyof typeof SPRINGS;
  clamp?: boolean;
  delay?: number;
  durationInFrames?: number;
}) {
  return spring({
    frame: frame - delay,
    fps,
    config: SPRINGS[preset],
    durationInFrames,
    ...(clamp ? { overshootClamping: true } : {}),
  });
}
