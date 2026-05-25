/**
 * VoiceInk theme system.
 *
 * Each theme is a palette of CSS variables that index.css consumes via
 * `var(--*)`. Switching a theme at runtime = overwrite those variables on
 * the :root element. No page reload, no Electron window recreate.
 *
 * A theme is made of:
 *   - `mode`  : 'dark' | 'light'  → base luminance
 *   - `accents` (3 colours)       → gradients, glows, buttons, accents
 *   - `surface` / `text` tokens   → glass panels, dividers, hover states
 *   - `aura`  : 3 big blurred spots  → ambient aurora background
 *
 * Users can also tune global effects (glow intensity, blur, animation
 * enabled). Effects are decoupled from the palette so any theme can be
 * "calmer" or "more vibrant".
 */

export type ThemeId =
  | 'midnight'   // default — violet / fuchsia / cyan on deep black (the v3 look)
  | 'aurora'    // cold nordic — cyan / teal / green
  | 'sunset'    // warm — orange / rose / magenta
  | 'cyberpunk' // high-contrast — magenta / cyan / yellow neon
  | 'ocean'     // deep blue — sapphire / turquoise / ice
  | 'mono';     // elegant monochrome — pure white accent on graphite

export type ThemeMode = 'dark' | 'light';

export interface ThemeEffects {
  /** 0 → no glow, 100 → extreme neon. Affects box-shadows of buttons / pill. */
  glowIntensity: number;        // 0..100  (default 65)
  /** Blur strength of glass panels, 0..30 px. */
  blurStrength: number;         // 0..30   (default 18)
  /** Backdrop aurora animation. When disabled, aurora freezes but remains visible. */
  animateAura: boolean;         // default true
  /** Render the aurora backdrop at all (in comfortable mode). */
  auraEnabled: boolean;         // default true
  /** Subtle shimmer on hover of glass panels. */
  shimmer: boolean;             // default true
  /** Grain / noise overlay on main surfaces for cinematic feel. */
  grain: boolean;               // default false
}

export const DEFAULT_EFFECTS: ThemeEffects = {
  glowIntensity: 65,
  blurStrength: 18,
  animateAura: true,
  auraEnabled: true,
  shimmer: true,
  grain: false,
};

export interface ThemePalette {
  /** Primary accent — main gradients, record button, links. */
  accent1: string;
  /** Secondary accent — gradient tail, badges, selections. */
  accent2: string;
  /** Tertiary accent — highlights, rarely used accent, aurora 3rd spot. */
  accent3: string;

  /** Deepest background. */
  bg0: string;
  /** Panels / cards base (glass). */
  bg1: string;
  /** Elevated surfaces. */
  bg2: string;

  /** Primary text. */
  text: string;
  /** Secondary text. */
  textDim: string;
  /** Muted text. */
  textMute: string;

  /** Divider lines. */
  line: string;
  lineStrong: string;

  /** Aurora blobs (3 colours). */
  aura1: string;
  aura2: string;
  aura3: string;

  /** State colours (kept consistent across themes). */
  danger: string;
  success: string;
  warn: string;
  info: string;
}

export interface Theme {
  id: ThemeId;
  name: string;
  description: string;
  mode: ThemeMode;
  palette: ThemePalette;
}

/**
 * ===========  THEMES  ===========
 */

export const THEMES: Record<ThemeId, Theme> = {
  midnight: {
    id: 'midnight',
    name: 'Midnight',
    description: 'Violet, fuchsia, cyan sur noir profond. Le thème signature de VoiceInk.',
    mode: 'dark',
    palette: {
      accent1: '#8b5cf6',
      accent2: '#d946ef',
      accent3: '#22d3ee',
      bg0: '#07070d',
      bg1: '#0d0d18',
      bg2: '#141426',
      text: '#f4f4fb',
      textDim: '#9ca0b5',
      textMute: '#626580',
      line: 'rgba(255,255,255,0.06)',
      lineStrong: 'rgba(255,255,255,0.12)',
      aura1: '#8b5cf6',
      aura2: '#22d3ee',
      aura3: '#d946ef',
      danger: '#f43f5e',
      success: '#10b981',
      warn: '#f59e0b',
      info: '#22d3ee',
    },
  },

  aurora: {
    id: 'aurora',
    name: 'Aurora',
    description: 'Cyan glacial, teal et vert nordique. Apaisant et futuriste.',
    mode: 'dark',
    palette: {
      accent1: '#06b6d4',
      accent2: '#14b8a6',
      accent3: '#22c55e',
      bg0: '#050c10',
      bg1: '#0a141a',
      bg2: '#101f28',
      text: '#eefaff',
      textDim: '#8bb2bf',
      textMute: '#567584',
      line: 'rgba(150,230,255,0.07)',
      lineStrong: 'rgba(150,230,255,0.14)',
      aura1: '#06b6d4',
      aura2: '#22c55e',
      aura3: '#14b8a6',
      danger: '#f87171',
      success: '#4ade80',
      warn: '#fbbf24',
      info: '#22d3ee',
    },
  },

  sunset: {
    id: 'sunset',
    name: 'Sunset',
    description: 'Orange chaud, rose et magenta crépusculaire. Énergique et chaleureux.',
    mode: 'dark',
    palette: {
      accent1: '#fb923c',
      accent2: '#f43f5e',
      accent3: '#a855f7',
      bg0: '#0f0708',
      bg1: '#180c0f',
      bg2: '#241118',
      text: '#fff5ef',
      textDim: '#d4a595',
      textMute: '#8a675e',
      line: 'rgba(255,200,160,0.07)',
      lineStrong: 'rgba(255,200,160,0.14)',
      aura1: '#fb923c',
      aura2: '#f43f5e',
      aura3: '#a855f7',
      danger: '#ef4444',
      success: '#84cc16',
      warn: '#fbbf24',
      info: '#f97316',
    },
  },

  cyberpunk: {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    description: 'Magenta, cyan et jaune néon haute tension. Contraste maximal.',
    mode: 'dark',
    palette: {
      accent1: '#ff006e',
      accent2: '#00f5ff',
      accent3: '#fbff00',
      bg0: '#050008',
      bg1: '#0a0212',
      bg2: '#12051c',
      text: '#ffffff',
      textDim: '#b0a3c4',
      textMute: '#665773',
      line: 'rgba(255,0,200,0.10)',
      lineStrong: 'rgba(255,0,200,0.20)',
      aura1: '#ff006e',
      aura2: '#00f5ff',
      aura3: '#fbff00',
      danger: '#ff3366',
      success: '#00ff9f',
      warn: '#fbff00',
      info: '#00f5ff',
    },
  },

  ocean: {
    id: 'ocean',
    name: 'Ocean',
    description: 'Saphir profond, turquoise et glace. Calme et concentré.',
    mode: 'dark',
    palette: {
      accent1: '#3b82f6',
      accent2: '#06b6d4',
      accent3: '#a5f3fc',
      bg0: '#050912',
      bg1: '#0a1220',
      bg2: '#0f1b2f',
      text: '#f0f7ff',
      textDim: '#94a8c4',
      textMute: '#5a6d8a',
      line: 'rgba(140,180,255,0.07)',
      lineStrong: 'rgba(140,180,255,0.14)',
      aura1: '#3b82f6',
      aura2: '#06b6d4',
      aura3: '#6366f1',
      danger: '#f43f5e',
      success: '#10b981',
      warn: '#f59e0b',
      info: '#06b6d4',
    },
  },

  mono: {
    id: 'mono',
    name: 'Monochrome',
    description: 'Graphite élégant, pur et minimaliste. Zéro couleur, maximum de classe.',
    mode: 'dark',
    palette: {
      accent1: '#ffffff',
      accent2: '#d4d4d8',
      accent3: '#a1a1aa',
      bg0: '#0a0a0b',
      bg1: '#111113',
      bg2: '#18181b',
      text: '#fafafa',
      textDim: '#a1a1aa',
      textMute: '#71717a',
      line: 'rgba(255,255,255,0.06)',
      lineStrong: 'rgba(255,255,255,0.12)',
      aura1: '#ffffff',
      aura2: '#a1a1aa',
      aura3: '#52525b',
      danger: '#f43f5e',
      success: '#10b981',
      warn: '#f59e0b',
      info: '#22d3ee',
    },
  },
};

/** List for pickers — ordered. */
export const THEME_ORDER: ThemeId[] = [
  'midnight',
  'aurora',
  'sunset',
  'cyberpunk',
  'ocean',
  'mono',
];

/** Safe lookup with fallback to default. */
export function getTheme(id: ThemeId | string | undefined): Theme {
  if (id && (THEMES as any)[id]) return (THEMES as any)[id] as Theme;
  return THEMES.midnight;
}
