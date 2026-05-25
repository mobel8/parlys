/**
 * Root — Remotion composition registry.
 *
 * Every composition we want to render must be registered here via
 * <Composition />. The CLI picks them up by `id` when calling
 *   npx remotion render VoiceInkPromo out.mp4
 *
 * Three compositions ship by default:
 *   1. VoiceInkPromo          — 1920×1080, 60s @ 60fps (master deliverable)
 *   2. VoiceInkPromoShort     — 1920×1080, 15s @ 60fps (Twitter / GIF)
 *   3. VoiceInkPromoVertical  — 1080×1920, 30s @ 60fps (Reels / TikTok)
 */
import React from 'react';
import { Composition } from 'remotion';
import { VoiceInkPromo }        from './VoiceInkPromo';
import { VoiceInkPromoShort }   from './VoiceInkPromoShort';
import { VoiceInkPromoVertical} from './VoiceInkPromoVertical';
import { FPS, WIDTH, HEIGHT, TOTAL_FRAMES } from './lib/theme';
import './styles.css';

/**
 * Composition registry.
 *
 * Each language ships as its own Composition id so the CLI can render
 * them independently: `npx remotion render VoiceInkPromo` vs
 * `npx remotion render VoiceInkPromoFR`. Behind the scenes both use
 * the same React tree — only the `lang` prop differs, which switches
 * the i18n context in LangProvider at the top.
 */
export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* English — master */}
      <Composition
        id="VoiceInkPromo"
        component={VoiceInkPromo}
        defaultProps={{ lang: 'en' as const }}
        durationInFrames={TOTAL_FRAMES}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
      {/* French — master */}
      <Composition
        id="VoiceInkPromoFR"
        component={VoiceInkPromo}
        defaultProps={{ lang: 'fr' as const }}
        durationInFrames={TOTAL_FRAMES}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
      {/* English — short */}
      <Composition
        id="VoiceInkPromoShort"
        component={VoiceInkPromoShort}
        defaultProps={{ lang: 'en' as const }}
        durationInFrames={900}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
      {/* French — short */}
      <Composition
        id="VoiceInkPromoShortFR"
        component={VoiceInkPromoShort}
        defaultProps={{ lang: 'fr' as const }}
        durationInFrames={900}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
      <Composition
        id="VoiceInkPromoVertical"
        component={VoiceInkPromoVertical}
        durationInFrames={1800}
        fps={FPS}
        width={1080}
        height={1920}
      />
    </>
  );
};
