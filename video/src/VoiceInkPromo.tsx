/**
 * VoiceInkPromo — the full 60-second composition.
 *
 * We build the timeline with Remotion's <Sequence> primitive, placing
 * each scene on the master timeline via its `from` frame. Scenes are
 * individually fully opaque; cross-fades happen inside each scene's
 * own fade-in / fade-out logic (see `SceneIntroLogo` etc.) — this
 * gives the artist (us) per-scene control over the transition
 * character (a hard cut on Problem → Pipeline, a soft dissolve on
 * VoiceClone → PillMode).
 *
 * A single <Audio /> track lives at the top, so the soundtrack plays
 * over every scene without having to be re-registered. Drop an MP3
 * into `public/audio/bg.mp3` and uncomment the <Audio /> block.
 */
import React from 'react';
import { AbsoluteFill, Sequence } from 'remotion';
import { SCENES } from './lib/theme';
import { LangProvider } from './lib/i18n';
import type { Lang } from './lib/strings';
import { SfxLayer } from './components/SfxLayer';
import { SceneIntroLogo }        from './scenes/SceneIntroLogo';
import { SceneTagline }          from './scenes/SceneTagline';
import { SceneProblem }          from './scenes/SceneProblem';
import { ScenePipeline }         from './scenes/ScenePipeline';
import { SceneLiveInterpreter }  from './scenes/SceneLiveInterpreter';
import { SceneVoiceClone }       from './scenes/SceneVoiceClone';
import { ScenePillMode }         from './scenes/ScenePillMode';
import { SceneStats }            from './scenes/SceneStats';
import { ScenePricing }          from './scenes/ScenePricing';
import { SceneFinalCTA }         from './scenes/SceneFinalCTA';

export const VoiceInkPromo: React.FC<{ lang?: Lang }> = ({ lang = 'en' }) => {
  return (
    <LangProvider lang={lang}>
    <AbsoluteFill style={{ backgroundColor: '#020410' }}>
      {/* ─── SFX bed ─────────────────────────────────────────────
         Master audio timeline — renders the ambient pad + every
         scene-scoped SFX hit from `src/lib/sfx.ts`. Decoupled from
         the visual scenes so a sound-designer can iterate on the
         mix without touching a single scene file. */}
      <SfxLayer />

      <Sequence name="1 · Intro"        from={SCENES.intro.start}        durationInFrames={SCENES.intro.duration}>
        <SceneIntroLogo />
      </Sequence>

      <Sequence name="2 · Tagline"      from={SCENES.tagline.start}      durationInFrames={SCENES.tagline.duration}>
        <SceneTagline />
      </Sequence>

      <Sequence name="3 · Problem"      from={SCENES.problem.start}      durationInFrames={SCENES.problem.duration}>
        <SceneProblem />
      </Sequence>

      <Sequence name="4 · Pipeline"     from={SCENES.pipeline.start}     durationInFrames={SCENES.pipeline.duration}>
        <ScenePipeline />
      </Sequence>

      <Sequence name="5 · Interpreter"  from={SCENES.interpreter.start}  durationInFrames={SCENES.interpreter.duration}>
        <SceneLiveInterpreter />
      </Sequence>

      <Sequence name="6 · Voice clone"  from={SCENES.voiceClone.start}   durationInFrames={SCENES.voiceClone.duration}>
        <SceneVoiceClone />
      </Sequence>

      <Sequence name="7 · Pill mode"    from={SCENES.pillMode.start}     durationInFrames={SCENES.pillMode.duration}>
        <ScenePillMode />
      </Sequence>

      <Sequence name="8 · Stats"        from={SCENES.stats.start}        durationInFrames={SCENES.stats.duration}>
        <SceneStats />
      </Sequence>

      <Sequence name="9 · Pricing"      from={SCENES.pricing.start}      durationInFrames={SCENES.pricing.duration}>
        <ScenePricing />
      </Sequence>

      <Sequence name="10 · Final CTA"   from={SCENES.cta.start}          durationInFrames={SCENES.cta.duration}>
        <SceneFinalCTA />
      </Sequence>
    </AbsoluteFill>
    </LangProvider>
  );
};
