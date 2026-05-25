# VoiceInk Landing

Marketing site — `voiceink.app`. Astro + Tailwind + React islands + Framer Motion.

## Run locally

```bash
cd landing
npm install
npm run dev
# → http://localhost:4321
```

## Structure

```
src/
├── layouts/
│   └── BaseLayout.astro      Wraps every page — meta, fonts, Nav, Footer.
├── components/
│   ├── Nav.astro             Sticky top nav with hide-on-scroll + blur intensity.
│   ├── Hero.astro            Aurora blobs + headline + interactive VoiceDemo island.
│   ├── VoiceDemo.tsx         Scripted pipeline simulation (React island).
│   ├── LogoMarquee.astro     Auto-scroll trust badges strip.
│   ├── FeaturesBento.astro   6-tile bento grid (Apple-style).
│   ├── HowItWorks.astro      4-step narrative timeline.
│   ├── Comparison.astro      VoiceInk vs Dragon vs Otter vs Translate.
│   ├── Pricing.tsx           3 tiers + monthly/yearly toggle (React island).
│   ├── Testimonials.astro    6-quote grid with hover glow.
│   ├── FAQ.astro             Native <details> accordion + JSON-LD schema.
│   ├── FinalCTA.astro        Last-scroll conversion surface.
│   └── Footer.astro          Columns + socials.
├── pages/
│   ├── index.astro           Assembles every component in the canonical order.
│   └── blog/ content/*.md    SEO articles (added in chantier 4).
├── styles/
│   └── global.css            Design tokens, `.glass`, `.btn-primary`, aurora, noise.
```

## Design system

- **Style**: Aurora UI + Glassmorphism + Motion-driven (inspired by Linear,
  Vercel, Cartesia, Superhuman).
- **Colors**: Ink 50–950 neutral palette + Aurora palette (cyan / blue /
  purple / pink / amber).
- **Typography**: Inter Variable (body), Geist (display), JetBrains Mono
  (metrics). Fluid hero scale via `clamp()`.
- **Motion**: Framer Motion for interactive components, pure CSS
  keyframes for decorative loops. Everything respects
  `prefers-reduced-motion`.
- **Accessibility**: WCAG AA contrast across body copy, AAA on the hero
  headline. Single focus ring utility (`.focus-ring`). Semantic HTML
  first (h1/h2, native `<details>` accordion, proper list roles).

## Deploy

Any static host works. Recommended:

- **Cloudflare Pages** — free unlimited bandwidth, global edge cache,
  builds from `main` in 60 s.
- **Vercel** — also free, slightly better Next.js integration (not
  relevant here).
- **Netlify** — fine, cheaper for "free brackets" businesses than
  Vercel when traffic grows.

```bash
npm run build              # emits dist/
npx wrangler pages deploy dist --project-name voiceink-landing
```

## Performance targets

- Lighthouse Performance ≥ 95 on desktop, ≥ 90 on mobile 4G.
- LCP < 1.8 s, CLS ≈ 0, INP < 200 ms.
- JS shipped to browser: < 80 kB gzipped (React + Framer Motion on the
  two interactive islands only).
- CSS: < 20 kB gzipped.

Re-measure before and after every section you add.
