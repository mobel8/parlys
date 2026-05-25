import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
//
// CSS pipeline: Tailwind is compiled OUT-OF-BAND by the standalone
// `tailwindcss` CLI into public/styles/app.css. Astro then serves it
// as a plain static asset referenced by BaseLayout.astro.
//
// Why not @astrojs/tailwind? Under Astro 5 on Windows (Node 24) the
// integration dropped our CSS output silently — the bundle reported
// 0 .css files regardless of config knobs. Bypassing Vite's CSS
// pipeline makes the build deterministic and easier to reason about.
//
// Local development runs `npm run watch:css` in parallel with the
// Astro dev server so Tailwind rebuilds the file on every change.
export default defineConfig({
  site: 'https://voiceink.app',
  integrations: [react(), sitemap()],
  // Static output — Cloudflare Pages / Vercel edge deploys it as-is.
  output: 'static',
  server: { port: 4321, host: true },
  build: {
    // Always emit external <link rel="stylesheet"> files for a
    // deterministic stylesheet graph on every page.
    inlineStylesheets: 'never',
  },
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'viewport',
  },
  vite: {
    ssr: {
      // framer-motion & lucide-react ship ESM, but older Astro tooling
      // sometimes trips on their package.json exports. Explicit
      // inline-deps keeps prod build deterministic.
      noExternal: ['framer-motion', 'lucide-react'],
    },
  },
});
