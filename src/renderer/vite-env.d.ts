/// <reference types="vite/client" />

// Build-time constants injected by Vite's `define` option (see vite.config.mts).
// Keeping them as `declare const` (not ambient module imports) mirrors how Vite
// substitutes them: simple identifier replacement, nothing to import.
declare const __APP_VERSION__: string;
declare const __APP_CHANGELOG__: string;
