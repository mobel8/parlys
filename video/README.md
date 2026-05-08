# VoiceInk Promo Video

A 60-second cinematic presentation of VoiceInk, built with
[Remotion](https://www.remotion.dev) (React + programmatic video).

Three compositions ship:

| ID                       | Ratio  | Duration | Use                      |
|--------------------------|--------|----------|--------------------------|
| `VoiceInkPromo`          | 16:9   | 60 s     | Master deliverable (YouTube / website hero) |
| `VoiceInkPromoShort`     | 16:9   | 15 s     | Twitter / X, GIF export, GitHub README |
| `VoiceInkPromoVertical`  | 9:16   | 30 s     | TikTok · Reels · Shorts  |

## Quick start

```bash
cd video
npm install       # ~ 90 seconds, ~ 500 MB
npm start         # opens Remotion Studio at http://localhost:3000
```

Remotion Studio gives you a live preview, timeline scrubbing,
per-scene focus, and one-click export buttons. It's the recommended
way to iterate.

## Render a video file

```bash
# Master 1080p
npm run render

# 4K
npm run render:4k

# Social (vertical)
npm run render:social

# GIF (short composition only)
npm run render:gif
```

Output lands in `out/`. Rendering a 60-second 1080p @ 60 fps clip
takes ~4–6 minutes on a modern M-series Mac or RTX laptop.

## Structure

```
src/
├── index.ts                 Entry (registerRoot)
├── Root.tsx                 Composition registry
├── styles.css               Tailwind v4 entry + brand tokens
├── VoiceInkPromo.tsx        Master 60 s composition
├── VoiceInkPromoShort.tsx   15 s highlights (T / X / GIF)
├── VoiceInkPromoVertical.tsx 30 s 9:16 (Reels / TikTok)
├── lib/
│   ├── theme.ts             BRAND colors, EASING, SCENES timeline table
│   └── spring.ts            Pre-baked spring presets (soft/punch/slow/bouncy)
├── components/
│   ├── AuroraBackground.tsx Mesh gradient blobs + grid overlay
│   ├── VoiceInkLogo.tsx     Animated V mark (glow, shimmer, path reveal)
│   ├── Waveform.tsx         Audio bar array (live / triggered)
│   ├── TypingText.tsx       Typewriter + stagger variants
│   ├── GradientText.tsx     Animated aurora gradient fill
│   └── GlassCard.tsx        Glassmorphic container with optional aurora border
└── scenes/
    ├── SceneIntroLogo.tsx          0:00 → 0:03
    ├── SceneTagline.tsx            0:03 → 0:08
    ├── SceneProblem.tsx            0:08 → 0:13
    ├── ScenePipeline.tsx           0:13 → 0:20
    ├── SceneLiveInterpreter.tsx    0:20 → 0:28
    ├── SceneVoiceClone.tsx         0:28 → 0:35
    ├── ScenePillMode.tsx           0:35 → 0:42
    ├── SceneStats.tsx              0:42 → 0:48
    ├── ScenePricing.tsx            0:48 → 0:54
    └── SceneFinalCTA.tsx           0:54 → 1:00
```

## Design system

Kept strictly in sync with the landing page — same ink palette, same
aurora gradients, same fonts. If a frame of this video is cropped
into a blog post, the two feel like one continuous surface.

- **Colours** — `BRAND` in `lib/theme.ts`
- **Springs** — `SPRINGS` in `lib/spring.ts` (soft / punch / slow / bouncy)
- **Easings** — `EASING` in `lib/theme.ts` (outExpo / inOut / backOut / outQuint)

## Adding a soundtrack

1. Grab a royalty-free track (Epidemic Sound, Artlist, Pixabay Music, YouTube Audio Library).
   Suggested vibe: **cinematic electronic, 110-125 BPM, building to a drop around 0:30** —
   think Cartesia's demo reel or Arc's launch film.

2. Drop it at `public/audio/bg.mp3`.

3. In `VoiceInkPromo.tsx`, uncomment the `<Audio>` block:

   ```tsx
   <Audio src={staticFile('audio/bg.mp3')} />
   ```

4. Hit preview. The audio is auto-included in every render.

## Adding voice-over

If you want a narrator, we recommend generating TTS from the narration
script below using Cartesia (same provider as the app itself — fitting).

Suggested narration (≈ 145 words, 60 s at natural pace):

> _VoiceInk. Your voice — finally, a superpower._
>
> _Most voice apps keep you waiting. One second. Two. Enough to ruin the conversation._
>
> _VoiceInk hears you, translates you, and speaks — in your own voice — in under 400 milliseconds._
>
> _It's four best-in-class models stitched together so tightly it feels like magic._
>
> _Speak French. Be heard in English. Speak English. Be heard in Japanese._
>
> _Clone your voice once. Dub anywhere forever, in 30 languages._
>
> _Always on top, never in the way. A pill on your screen. A superpower in your hand._
>
> _Free forever — or go Pro for less than ten euros a month._
>
> _VoiceInk. Speak once. The world understands._
>
> _**voiceink dot app**._

Save the TTS as `public/audio/vo.mp3` and add a second `<Audio>` with
`volume={0.9}` (VO) while dimming `bg.mp3` to `volume={0.3}`.

## Licence

This folder is source code we wrote in-house. Remotion itself has a
special licence — review at [remotion.dev/license](https://remotion.dev/license).
The Individual / Startup terms cover VoiceInk until we cross the
3-developer team mark.
