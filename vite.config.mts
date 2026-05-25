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
 * HTML transform plugin: exposes the THEMES table on `window` (kept for
 * any debug tooling that wants to introspect the palettes at runtime)
 * and otherwise lets the inline bootstrap in `index.html` do all the
 * pre-paint work.
 *
 * History: this plugin used to ALSO inject a second pre-apply-theme
 * snippet, but that snippet read `;fx=…` from the URL while main encodes
 * `;effects=…` (full JSON). The mismatch meant the second snippet
 * silently fell back to the DEFAULT effects (glow=65, blur=18, grain=0)
 * after the first inline bootstrap had correctly stamped the user's
 * values from `;effects=…`. React's later applyTheme() then re-stamped
 * the correct values, producing the visible "default theme briefly,
 * then user theme" flash on every density swap. The fix is simply to
 * stop running that broken second snippet — the inline bootstrap in
 * index.html already does the job, and correctly.
 */
function preApplyThemePlugin(): Plugin {
  return {
    name: 'voiceink-pre-apply-theme',
    transformIndexHtml(html) {
      const inject = `\n    <script>window.__VOICEINK_THEMES__ = ${THEMES_JSON};</script>`;
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
