/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // VoiceInk brand palette — kept in sync with the Electron app's
        // "Arctic Pulse" theme so marketing and product feel like one
        // continuous surface.
        ink: {
          50:  '#f5f7fb',
          100: '#e8ecf5',
          200: '#c8d1e2',
          300: '#93a1bf',
          400: '#5e708f',
          500: '#384766',
          600: '#22304b',
          700: '#141e33',
          800: '#0a1124',
          900: '#050816',
          950: '#020410',
        },
        fuchsia: {
          400: '#e879f9',
          500: '#d946ef',
          600: '#c026d3',
        },
        aurora: {
          cyan:   '#22d3ee',
          blue:   '#60a5fa',
          purple: '#a78bfa',
          pink:   '#f472b6',
          amber:  '#fbbf24',
        },
      },
      fontFamily: {
        sans: ['Inter Variable', 'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Geist', 'Inter Variable', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        // Fluid display scale — scales from mobile 3xl to desktop 7xl
        // via clamp(). Used for hero headlines only.
        'hero':    ['clamp(2.25rem, 1.5rem + 3.5vw, 5rem)',  { lineHeight: '1.05', letterSpacing: '-0.03em' }],
        'display': ['clamp(1.75rem, 1.1rem + 2.5vw, 3.5rem)', { lineHeight: '1.1',  letterSpacing: '-0.025em' }],
        'section': ['clamp(1.5rem, 1rem + 1.6vw, 2.5rem)',    { lineHeight: '1.15', letterSpacing: '-0.02em' }],
      },
      animation: {
        // Aurora background — continuous 18s loop. Perceived motion
        // without being distracting.
        aurora: 'aurora 18s ease-in-out infinite',
        // Glow pulse on hero CTA button
        'pulse-glow': 'pulseGlow 2.4s ease-in-out infinite',
        // Gradient shimmer on text
        shimmer: 'shimmer 4s linear infinite',
        // Slow float for floating decorative elements
        float: 'float 8s ease-in-out infinite',
        // Staggered text reveal
        'fade-up': 'fadeUp 0.7s cubic-bezier(0.22, 1, 0.36, 1) both',
      },
      keyframes: {
        aurora: {
          '0%, 100%': { transform: 'translate3d(0, 0, 0) scale(1) rotate(0deg)', opacity: '0.55' },
          '33%':      { transform: 'translate3d(2%, -3%, 0) scale(1.08) rotate(2deg)', opacity: '0.75' },
          '66%':      { transform: 'translate3d(-2%, 2%, 0) scale(0.96) rotate(-2deg)', opacity: '0.65' },
        },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(167, 139, 250, 0.55), 0 20px 48px -12px rgba(167, 139, 250, 0.45)' },
          '50%':      { boxShadow: '0 0 0 12px rgba(167, 139, 250, 0), 0 24px 56px -12px rgba(167, 139, 250, 0.6)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition:  '200% 0' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%':      { transform: 'translateY(-12px)' },
        },
        fadeUp: {
          '0%':   { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      backgroundImage: {
        'aurora-mesh':
          'radial-gradient(at 16% 12%, rgba(167,139,250,0.55) 0, transparent 55%),' +
          'radial-gradient(at 86% 22%, rgba(34,211,238,0.45) 0, transparent 60%),' +
          'radial-gradient(at 30% 88%, rgba(244,114,182,0.40) 0, transparent 60%),' +
          'radial-gradient(at 82% 82%, rgba(96,165,250,0.50) 0, transparent 60%)',
        'grid-line': 'linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px)',
      },
      boxShadow: {
        'glass': '0 8px 32px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
        'glow-cyan':   '0 0 48px -12px rgba(34, 211, 238, 0.55)',
        'glow-fuchsia':'0 0 48px -12px rgba(217, 70, 239, 0.55)',
        'glow-violet': '0 0 48px -12px rgba(167, 139, 250, 0.55)',
      },
    },
  },
  plugins: [],
};
