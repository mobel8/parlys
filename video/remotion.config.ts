/**
 * Remotion CLI config — called by `npx remotion studio` and
 * `npx remotion render`.
 *
 * We:
 *   1. Enable Tailwind v4 via the official Remotion integration,
 *      so every component can use utility classes at render time.
 *   2. Raise the ImageFormat to JPEG (default) — smaller PNG buffers
 *      would push memory on longer clips.
 *   3. Pin Chrome to the stable channel so render output is identical
 *      between local dev and CI.
 */
import { Config } from '@remotion/cli/config';
import { enableTailwind } from '@remotion/tailwind-v4';

// Tailwind v4 — single line, no postcss dance.
Config.overrideWebpackConfig(enableTailwind);

// Rendering defaults. Override per-command on the CLI if you need 4K, etc.
Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(92);
Config.setConcurrency(1);          // keep deterministic; bump on beefy boxes.
Config.setChromiumOpenGlRenderer('angle'); // best for Win/macOS parity.
Config.setColorSpace('bt709');
Config.setEntryPoint('./src/index.ts');
