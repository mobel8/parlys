/**
 * Central brand + animation tokens for the entire video.
 *
 * Keeping everything here lets us retime the whole 60-second piece
 * by editing one file (e.g. rename a color, shift an easing curve),
 * without hunting through 10 scene components.
 */

export const BRAND = {
  // Hex values double-checked against the landing page's Tailwind
  // config at d:\voiceink\landing\tailwind.config.mjs.
  purple: '#a78bfa',
  cyan:   '#22d3ee',
  pink:   '#f472b6',
  amber:  '#fbbf24',
  blue:   '#60a5fa',
  fuchsia:'#d946ef',
  emerald:'#34d399',

  // Full ink scale — mirrors tailwind.config.ts so scene code and
  // utility classes reference the same values.
  ink50:  '#f5f7fb',
  ink100: '#e8ecf5',
  ink200: '#c8d1e2',
  ink300: '#93a1bf',
  ink400: '#5e708f',
  ink500: '#384766',
  ink600: '#22304b',
  ink700: '#141e33',
  ink800: '#0a1124',
  ink900: '#050816',
  ink950: '#020410',
} as const;

export const GRADIENTS = {
  // Primary aurora — used on hero, logo, CTAs.
  aurora: `linear-gradient(110deg, ${BRAND.purple} 0%, ${BRAND.cyan} 35%, ${BRAND.pink} 70%, ${BRAND.amber} 100%)`,
  auroraReverse: `linear-gradient(290deg, ${BRAND.purple} 0%, ${BRAND.cyan} 35%, ${BRAND.pink} 70%, ${BRAND.amber} 100%)`,

  // Subtle V aurora used on the logo mark
  brandMark: `linear-gradient(135deg, ${BRAND.purple} 0%, ${BRAND.fuchsia} 50%, ${BRAND.cyan} 100%)`,

  // Text accent
  accent: `linear-gradient(90deg, ${BRAND.purple}, ${BRAND.cyan}, ${BRAND.pink})`,
} as const;

/**
 * Easing curves reused across scenes. Remotion's `spring()` handles
 * physics-based motion; for pure cubic-bezier interpolation we call
 * `interpolate(... { easing: EASE_OUT_EXPO })`.
 */
import { Easing } from 'remotion';

export const EASING = {
  // Smooth deceleration — default for UI reveals.
  outExpo:   Easing.bezier(0.16, 1, 0.3, 1),
  // Gentle S — paragraphs, long stretches.
  inOut:     Easing.bezier(0.65, 0, 0.35, 1),
  // Playful overshoot — logos, accent reveals (pair with clamp-to-1).
  backOut:   Easing.bezier(0.34, 1.56, 0.64, 1),
  // Hard entry + soft exit — used for the pipeline chips.
  outQuint:  Easing.bezier(0.22, 1, 0.36, 1),
} as const;

/**
 * Scene timing. All scenes are laid out head-to-tail on a single
 * 60-second timeline. Duration numbers are in FRAMES @ 60 fps.
 *
 * Total = 3600 frames (60 seconds).
 */
export const SCENES = {
  intro:        { start:    0, duration: 180 },  // 3.0 s
  tagline:      { start:  180, duration: 300 },  // 5.0 s
  problem:      { start:  480, duration: 300 },  // 5.0 s
  pipeline:     { start:  780, duration: 420 },  // 7.0 s
  interpreter:  { start: 1200, duration: 480 },  // 8.0 s
  voiceClone:   { start: 1680, duration: 420 },  // 7.0 s
  pillMode:     { start: 2100, duration: 420 },  // 7.0 s
  stats:        { start: 2520, duration: 360 },  // 6.0 s
  pricing:      { start: 2880, duration: 360 },  // 6.0 s
  cta:          { start: 3240, duration: 360 },  // 6.0 s
} as const;

export const TOTAL_FRAMES = 3600;
export const FPS = 60;
export const WIDTH = 1920;
export const HEIGHT = 1080;
