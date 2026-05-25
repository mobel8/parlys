import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Same brand palette as the marketing landing so any crop of the
      // video dropped into a blog post feels identical to the site.
      colors: {
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
        aurora: {
          cyan:   '#22d3ee',
          blue:   '#60a5fa',
          purple: '#a78bfa',
          pink:   '#f472b6',
          amber:  '#fbbf24',
          fuchsia:'#d946ef',
        },
      },
      fontFamily: {
        display: ['"Geist"', '"Inter"', 'system-ui', 'sans-serif'],
        sans:    ['"Inter"', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
