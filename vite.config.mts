import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import fs from 'fs';

// Single source of truth for the app version: package.json. The renderer
// never reads package.json at runtime (it's not in the asar), so we inline
// the value at build time.
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));

// Inline CHANGELOG.md too so the in-app "click the version to see history"
// dialog works fully offline with zero filesystem access from the renderer.
// Falls back to a minimal placeholder if the file is missing, so a first-time
// checkout without CHANGELOG.md still builds cleanly.
let changelog = '';
try {
  changelog = fs.readFileSync(path.resolve(__dirname, 'CHANGELOG.md'), 'utf-8');
} catch {
  changelog = '# Changelog\n\n_Aucun historique disponible._\n';
}

/**
 * Pre-paint theme: extract THEMES from src/shared/themes.ts at build time
 * so the inline bootstrap in index.html can stamp CSS vars on <html>
 * synchronously, BEFORE any CSS rule evaluates. Without this, the very
 * first frame uses the Midnight defaults baked into :root in index.css,
 * then React mounts ~10-50 ms later and overwrites them via applyTheme() —
 * visible as a violet→user-theme flash on every cold launch.
 *
 * We parse themes.ts as text rather than importing it: themes.ts is a TS
 * module, and importing it from a Vite config would require a TS loader
 * dance. The file is pure data (no executable logic, no imports), so a
 * regex-based extractor is robust enough and stays DRY with the runtime
 * code that imports themes.ts directly.
 */
function extractThemesJson(): string {
  const src = fs.readFileSync(path.resolve(__dirname, 'src/shared/themes.ts'), 'utf-8');
  // Find `export const THEMES: ... = { ... };` and slice the object literal.
  const i = src.indexOf('export const THEMES');
  if (i < 0) throw new Error('THEMES not found in themes.ts');
  const open = src.indexOf('{', i);
  let depth = 0;
  let end = -1;
  for (let j = open; j < src.length; j++) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = j + 1; break; } }
  }
  if (end < 0) throw new Error('THEMES object not closed');
  const literal = src.slice(open, end);
  // Strip TS-only constructs: trailing commas before `}` are valid in JSON5
  // but not in strict JSON. Use Function-eval to coerce object-literal → JSON.
  // The source is trusted (our own file), so eval is fine here.
  // eslint-disable-next-line no-new-func
  const obj = (new Function(`return (${literal});`))();
  return JSON.stringify(obj);
}

const THEMES_JSON = extractThemesJson();

/**
 * HTML transform plugin: injects two `<script>` blocks into <head> right
 * after the existing density bootstrap so they run synchronously during
 * HTML parse.
 *
 *   1. `window.__VOICEINK_THEMES__ = {…}` — the full palette table.
 *   2. The "pre-apply theme" snippet: reads themeId + effects from the
 *      URL hash, looks up the palette, and writes every CSS variable
 *      that lib/theme.ts would write — so the FIRST PAINT already shows
 *      the user's theme. React's later applyTheme() becomes a no-op
 *      visually because the values match.
 */
function preApplyThemePlugin(): Plugin {
  return {
    name: 'voiceink-pre-apply-theme',
    transformIndexHtml(html) {
      const inject = `
    <script>window.__VOICEINK_THEMES__ = ${THEMES_JSON};</script>
    <script>
      /* Pre-apply theme synchronously, BEFORE any CSS rule evaluates.
         Reads the user's themeId from the URL hash (encoded by main in
         loadRenderer()) and writes every CSS variable that
         src/renderer/lib/theme.ts would write. Without this, the first
         frame uses the Midnight defaults baked into :root, and React's
         applyTheme() ~10-50 ms later flashes the right palette in. */
      (function () {
        try {
          var hash = (location.hash || '').replace('#', '');
          var themeMatch = hash.match(/(?:^|;)theme=([a-z0-9_-]+)/i);
          var fxMatch = hash.match(/(?:^|;)fx=([^;]+)/i);
          var THEMES = window.__VOICEINK_THEMES__ || {};
          var theme = (themeMatch && THEMES[themeMatch[1]]) || THEMES.midnight;
          if (!theme) return;
          var p = theme.palette;
          var root = document.documentElement;
          function hexToRgb(hex) {
            var h = (hex || '').replace('#', '').trim();
            if (h.length === 3) {
              return parseInt(h[0]+h[0],16) + ',' + parseInt(h[1]+h[1],16) + ',' + parseInt(h[2]+h[2],16);
            }
            if (h.length === 6) {
              return parseInt(h.slice(0,2),16) + ',' + parseInt(h.slice(2,4),16) + ',' + parseInt(h.slice(4,6),16);
            }
            return '139,92,246';
          }
          function darken(hex, amount) {
            var rgb = hexToRgb(hex).split(',').map(Number);
            return 'rgb(' + Math.max(0, Math.round(rgb[0]*(1-amount))) + ',' + Math.max(0, Math.round(rgb[1]*(1-amount))) + ',' + Math.max(0, Math.round(rgb[2]*(1-amount))) + ')';
          }
          function lighten(hex, amount) {
            var rgb = hexToRgb(hex).split(',').map(Number);
            return 'rgb(' + Math.min(255, Math.round(rgb[0]+(255-rgb[0])*amount)) + ',' + Math.min(255, Math.round(rgb[1]+(255-rgb[1])*amount)) + ',' + Math.min(255, Math.round(rgb[2]+(255-rgb[2])*amount)) + ')';
          }
          function lum(hex) {
            var rgb = hexToRgb(hex).split(',').map(Number);
            return (0.2126*rgb[0] + 0.7152*rgb[1] + 0.0722*rgb[2]) / 255;
          }
          var s = root.style;
          s.setProperty('--bg-0', p.bg0);
          s.setProperty('--bg-1', p.bg1);
          s.setProperty('--bg-2', p.bg2);
          s.setProperty('--line', p.line);
          s.setProperty('--line-strong', p.lineStrong);
          s.setProperty('--text', p.text);
          s.setProperty('--text-dim', p.textDim);
          s.setProperty('--text-mute', p.textMute);
          s.setProperty('--accent-1', p.accent1);
          s.setProperty('--accent-2', p.accent2);
          s.setProperty('--accent-3', p.accent3);
          s.setProperty('--accent-1-rgb', hexToRgb(p.accent1));
          s.setProperty('--accent-2-rgb', hexToRgb(p.accent2));
          s.setProperty('--accent-3-rgb', hexToRgb(p.accent3));
          s.setProperty('--accent-1-dim', darken(p.accent1, 0.35));
          s.setProperty('--accent-1-light', lighten(p.accent1, 0.25));
          s.setProperty('--on-accent', lum(p.accent1) > 0.65 ? '#0a0a0a' : '#ffffff');
          s.setProperty('--violet', p.accent1);
          s.setProperty('--fuchsia', p.accent2);
          s.setProperty('--cyan', p.accent3);
          s.setProperty('--aura-1', p.aura1);
          s.setProperty('--aura-2', p.aura2);
          s.setProperty('--aura-3', p.aura3);
          s.setProperty('--danger', p.danger);
          s.setProperty('--success', p.success);
          s.setProperty('--warn', p.warn);
          s.setProperty('--info', p.info);
          s.setProperty('--danger-rgb', hexToRgb(p.danger));
          s.setProperty('--success-rgb', hexToRgb(p.success));
          /* Effects from URL hash. Format: ;fx=g=65,b=18,a=1,u=1,s=1,n=0 */
          var fx = { glowIntensity: 65, blurStrength: 18, animateAura: true, auraEnabled: true, shimmer: true, grain: false };
          if (fxMatch) {
            fxMatch[1].split(',').forEach(function (kv) {
              var parts = kv.split('=');
              var k = parts[0]; var v = parts[1];
              if (k === 'g') fx.glowIntensity = +v;
              else if (k === 'b') fx.blurStrength = +v;
              else if (k === 'a') fx.animateAura = v === '1';
              else if (k === 'u') fx.auraEnabled = v === '1';
              else if (k === 's') fx.shimmer = v === '1';
              else if (k === 'n') fx.grain = v === '1';
            });
          }
          var glow = Math.max(0, Math.min(100, fx.glowIntensity)) / 100;
          s.setProperty('--glow-intensity', String(glow));
          s.setProperty('--blur-strength', Math.round(fx.blurStrength) + 'px');
          root.dataset.theme = theme.id;
          root.dataset.themeMode = theme.mode;
          root.dataset.animateAura = fx.animateAura ? '1' : '0';
          root.dataset.auraEnabled = fx.auraEnabled ? '1' : '0';
          root.dataset.shimmer = fx.shimmer ? '1' : '0';
          root.dataset.grain = fx.grain ? '1' : '0';
          /* Body bg: paint immediately so the window's solid backgroundColor
             (set by main BEFORE the renderer loads) is hidden under the
             user's actual bg0 from frame 1. */
          if (document.body) document.body.style.backgroundColor = p.bg0;
          else document.addEventListener('DOMContentLoaded', function () {
            document.body.style.backgroundColor = p.bg0;
          }, { once: true });
        } catch (_) { /* no-op — fall back to :root defaults */ }
      })();
    </script>`;
      // Inject right before </head> so it runs alongside the existing
      // density bootstrap script (which is in <head>) and BEFORE any
      // <link rel="stylesheet"> Vite emits at build time.
      return html.replace('</head>', inject + '\n  </head>');
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), preApplyThemePlugin()],
  root: '.',
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_CHANGELOG__: JSON.stringify(changelog),
  },
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  server: {
    port: 5173,
  },
});
