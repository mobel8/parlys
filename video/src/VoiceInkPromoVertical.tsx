/**
 * VoiceInkPromoVertical — a 1080×1920 version for TikTok / Reels / Shorts.
 *
 * The landscape scenes re-use their logic, but we wrap each one in
 * a container that slightly zooms in and centres the action so the
 * 16:9 content reads well inside a 9:16 frame.
 *
 * For a production launch we'd author dedicated vertical scenes
 * (most importantly, stacked layouts for the pipeline + interpreter);
 * this wrapper is the "good enough" first pass that lets us ship the
 * vertical spec immediately.
 */
import React from 'react';
import { AbsoluteFill, Sequence } from 'remotion';
import { SCENES } from './lib/theme';
import { SceneIntroLogo }        from './scenes/SceneIntroLogo';
import { SceneTagline }          from './scenes/SceneTagline';
import { SceneLiveInterpreter }  from './scenes/SceneLiveInterpreter';
import { SceneVoiceClone }       from './scenes/SceneVoiceClone';
import { SceneStats }            from './scenes/SceneStats';
import { SceneFinalCTA }         from './scenes/SceneFinalCTA';

/** Utility — zoom a 16:9 scene to fit a 9:16 viewport with margins. */
const Vertical: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill
    style={{
      overflow: 'hidden',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <div
      style={{
        // 16:9 source 1920×1080 rendered at 1080 wide → 1080×607;
        // we up-scale 1.3× to fill the vertical better.
        width: 1920,
        height: 1080,
        transform: 'scale(1.05)',
        transformOrigin: '50% 50%',
      }}
    >
      {children}
    </div>
  </AbsoluteFill>
);

export const VoiceInkPromoVertical: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: '#020410' }}>
    <Sequence name="Intro"       from={0}                                       durationInFrames={SCENES.intro.duration}><Vertical><SceneIntroLogo /></Vertical></Sequence>
    <Sequence name="Tagline"     from={SCENES.tagline.start - SCENES.problem.duration} durationInFrames={SCENES.tagline.duration}><Vertical><SceneTagline /></Vertical></Sequence>
    <Sequence name="Interpreter" from={480}                                     durationInFrames={SCENES.interpreter.duration}><Vertical><SceneLiveInterpreter /></Vertical></Sequence>
    <Sequence name="Voice clone" from={960}                                     durationInFrames={SCENES.voiceClone.duration}><Vertical><SceneVoiceClone /></Vertical></Sequence>
    <Sequence name="Stats"       from={1380}                                    durationInFrames={SCENES.stats.duration}><Vertical><SceneStats /></Vertical></Sequence>
    <Sequence name="CTA"         from={1740}                                    durationInFrames={SCENES.cta.duration}><Vertical><SceneFinalCTA /></Vertical></Sequence>
  </AbsoluteFill>
);
