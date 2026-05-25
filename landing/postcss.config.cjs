// Standard Tailwind v3 postcss pipeline. CommonJS (.cjs) explicit
// because Astro 5's CSS pipe on Windows/node-20 was loading the ESM
// .mjs variant with a stale cache and silently dropping the output.
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
