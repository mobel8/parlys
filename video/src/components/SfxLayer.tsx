/**
 * SfxLayer — one big block of Remotion `<Audio>` tags, each wrapped in
 * a `<Sequence>` that sets its start frame.
 *
 * Why one component instead of inlining `<Audio>` in each scene:
 *   1. The whole timeline lives in a single source of truth
 *      (`src/lib/sfx.ts`), so sound designers can tweak timings
 *      without touching scene code.
 *   2. Remotion's rendering cost for `<Audio>` is negligible —
 *      instances are only materialised on the frames they're active.
 *   3. Crossfades and layered hits become easier since they're all
 *      in one file.
 *
 * The layer renders nothing visual (`<></>`), it just registers audio
 * sources on the timeline. Mount it as a sibling of the scene
 * `<Sequence>`s in `VoiceInkPromo.tsx`.
 */
import React from 'react';
import { Audio, Sequence, staticFile } from 'remotion';
import { SFX_TIMELINE } from '../lib/sfx';

export const SfxLayer: React.FC = () => {
  return (
    <>
      {SFX_TIMELINE.map((ev, i) => {
        // `durationInFrames` must be finite and >= 1 to satisfy the
        // Sequence contract; when an event omits `duration` we pick
        // 90 (1.5 s @ 60 fps) which outlasts every SFX except the pad
        // and is clipped by the audio file's natural length.
        const dur = ev.duration ?? 90;
        return (
          <Sequence
            key={`sfx-${i}-${ev.file}-${ev.at}`}
            from={ev.at}
            durationInFrames={Math.max(1, dur)}
            name={`SFX · ${ev.file}${ev.note ? ` — ${ev.note}` : ''}`}
          >
            <Audio
              src={staticFile(`sfx/${ev.file}`)}
              volume={ev.volume ?? 1}
            />
          </Sequence>
        );
      })}
    </>
  );
};
