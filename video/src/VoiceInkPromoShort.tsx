/**
 * VoiceInkPromoShort — a condensed 15-second highlight reel.
 *
 * Use cases:
 *   - Twitter/X upload (max 2:20, but 15s performs best).
 *   - LinkedIn auto-play previews.
 *   - GIF export for GitHub README header.
 *
 * We keep only the 5 scenes that land hardest on their own:
 *   Intro (2s) → Tagline (3s) → Interpreter (5s) → Stats (3s) → CTA (2s)
 *
 * Scenes are re-timed (duration shrunk, no overlap) so each scene
 * plays a compressed version of itself. We do NOT re-author the
 * scenes — we just let their internal fades adapt to the shorter
 * windows.
 */
import React from 'react';
import { AbsoluteFill, Sequence } from 'remotion';
import { LangProvider } from './lib/i18n';
import type { Lang } from './lib/strings';
import { SceneIntroLogo }       from './scenes/SceneIntroLogo';
import { SceneTagline }         from './scenes/SceneTagline';
import { SceneLiveInterpreter } from './scenes/SceneLiveInterpreter';
import { SceneStats }           from './scenes/SceneStats';
import { SceneFinalCTA }        from './scenes/SceneFinalCTA';

export const VoiceInkPromoShort: React.FC<{ lang?: Lang }> = ({ lang = 'en' }) => (
  <LangProvider lang={lang}>
  <AbsoluteFill style={{ backgroundColor: '#020410' }}>
    <Sequence name="Intro"       from={0}   durationInFrames={120}><SceneIntroLogo /></Sequence>
    <Sequence name="Tagline"     from={120} durationInFrames={180}><SceneTagline /></Sequence>
    <Sequence name="Interpreter" from={300} durationInFrames={300}><SceneLiveInterpreter /></Sequence>
    <Sequence name="Stats"       from={600} durationInFrames={180}><SceneStats /></Sequence>
    <Sequence name="CTA"         from={780} durationInFrames={120}><SceneFinalCTA /></Sequence>
  </AbsoluteFill>
  </LangProvider>
);
