/**
 * Kept minimal — Remotion's @remotion/tailwind-v4 plugin wires the
 * real pipeline at bundle time. This file is here so editor tooling
 * and future `postcss-cli` calls work locally.
 */
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
