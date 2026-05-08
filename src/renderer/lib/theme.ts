/**
 * Runtime theme applier.
 *
 * We keep the hot path simple: `applyTheme(theme, effects)` writes all the
 * CSS custom properties onto `:root` and toggles a handful of data-*
 * attributes. `index.css` reads everything through `var(--*)` so a theme
 * swap re-paints the whole app instantly, zero reload.
 *
 * Also derives a few secondary variables (hover shades, glow RGBA, gradient
 * stops) from the palette so every theme gets a coherent look without
 * hand-tuning each token.
 */

import { Theme, ThemeEffects, getTheme } from '../../shared/themes';

/** Convert `#rrggbb` to `r,g,b` string for rgba() usage. */
function hexToRgb(hex: string): string {
  const h = hex.replace('#', '').trim();
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16);
    const g = parseInt(h[1] + h[1], 16);
    const b = parseInt(h[2] + h[2], 16);
    return `${r},${g},${b}`;
  }
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `${r},${g},${b}`;
  }
  return '139,92,246'; // fallback violet
}

/** Mix a hex colour with black by `amount` (0..1). */
function darken(hex: string, amount: number): string {
  const rgb = hexToRgb(hex).split(',').map(Number);
  const [r, g, b] = rgb.map((c) => Math.max(0, Math.round(c * (1 - amount))));
  return `rgb(${r},${g},${b})`;
}

/** Mix a hex colour with white by `amount` (0..1). */
function lighten(hex: string, amount: number): string {
  const rgb = hexToRgb(hex).split(',').map(Number);
  const [r, g, b] = rgb.map((c) => Math.min(255, Math.round(c + (255 - c) * amount)));
  return `rgb(${r},${g},${b})`;
}

/**
 * Relative luminance (WCAG-style, simplified) of a hex colour.
 * Returns a value in [0, 1]; >0.65 means "light enough that white text
 * wouldn't read on it" so we should use dark foreground instead.
 */
function luminance(hex: string): number {
  const rgb = hexToRgb(hex).split(',').map(Number);
  const [r, g, b] = rgb;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export function applyTheme(themeOrId: Theme | string | undefined, effects: ThemeEffects): void {
  if (typeof document === 'undefined') return;
  const theme = typeof themeOrId === 'string' || !themeOrId ? getTheme(themeOrId as any) : themeOrId;
  const { palette } = theme;
  const root = document.documentElement;

  // Base tokens
  root.style.setProperty('--bg-0', palette.bg0);
  root.style.setProperty('--bg-1', palette.bg1);
  root.style.setProperty('--bg-2', palette.bg2);
  root.style.setProperty('--line', palette.line);
  root.style.setProperty('--line-strong', palette.lineStrong);
  root.style.setProperty('--text', palette.text);
  root.style.setProperty('--text-dim', palette.textDim);
  root.style.setProperty('--text-mute', palette.textMute);

  // Accents
  root.style.setProperty('--accent-1', palette.accent1);
  root.style.setProperty('--accent-2', palette.accent2);
  root.style.setProperty('--accent-3', palette.accent3);
  root.style.setProperty('--accent-1-rgb', hexToRgb(palette.accent1));
  root.style.setProperty('--accent-2-rgb', hexToRgb(palette.accent2));
  root.style.setProperty('--accent-3-rgb', hexToRgb(palette.accent3));
  root.style.setProperty('--accent-1-dim', darken(palette.accent1, 0.35));
  root.style.setProperty('--accent-1-light', lighten(palette.accent1, 0.25));

  // Foreground colour that reads on top of accent-1.  Light accents (e.g.
  // the Monochrome theme's pure-white accent) need a dark icon; every
  // other palette is dark enough that white stays legible.
  const onAccent = luminance(palette.accent1) > 0.65 ? '#0a0a0a' : '#ffffff';
  root.style.setProperty('--on-accent', onAccent);

  // Legacy tokens kept for components that weren't refactored yet
  root.style.setProperty('--violet', palette.accent1);
  root.style.setProperty('--fuchsia', palette.accent2);
  root.style.setProperty('--cyan', palette.accent3);

  // Aurora blobs
  root.style.setProperty('--aura-1', palette.aura1);
  root.style.setProperty('--aura-2', palette.aura2);
  root.style.setProperty('--aura-3', palette.aura3);

  // State colours
  root.style.setProperty('--danger', palette.danger);
  root.style.setProperty('--success', palette.success);
  root.style.setProperty('--warn', palette.warn);
  root.style.setProperty('--info', palette.info);
  root.style.setProperty('--danger-rgb', hexToRgb(palette.danger));
  root.style.setProperty('--success-rgb', hexToRgb(palette.success));

  // Effects — derived runtime tunables
  const glow = Math.max(0, Math.min(100, effects.glowIntensity)) / 100;
  root.style.setProperty('--glow-intensity', String(glow));
  root.style.setProperty('--blur-strength', `${Math.round(effects.blurStrength)}px`);

  // Meta attributes for conditional CSS rules
  root.dataset.theme = theme.id;
  root.dataset.themeMode = theme.mode;
  root.dataset.animateAura = effects.animateAura ? '1' : '0';
  root.dataset.auraEnabled = effects.auraEnabled ? '1' : '0';
  root.dataset.shimmer = effects.shimmer ? '1' : '0';
  root.dataset.grain = effects.grain ? '1' : '0';

  // Body bg colour fallback (non-transparent mode)
  document.body.style.backgroundColor = palette.bg0;
}
