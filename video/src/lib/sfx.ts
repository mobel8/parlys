/**
 * sfx.ts — master SFX timeline for the 60-second promo.
 *
 * Each entry declares:
 *   - `at`         the absolute start frame (60 fps)
 *   - `file`       filename under public/sfx/*.wav
 *   - `volume?`    0–1 (default 1)
 *   - `duration?`  frames; if omitted, the Sequence runs until the
 *                  file ends (Remotion handles tail truncation).
 *
 * Design notes — attention-retention & conversion engineering:
 *   - Every scene boundary gets a whoosh to signal "something new".
 *   - Big numbers and benefit reveals ring a chime or ding so the
 *     viewer's brain tags them as "accomplishment".
 *   - Tension scenes (Problem, Interpreter) layer a heartbeat or
 *     sweep-up to push the reptilian brain toward urgency.
 *   - A continuous low ambient `pad.wav` binds every cut together.
 *   - Nothing is louder than -6 dBFS (`volume: 0.5`) on the mids so
 *     the VO layer (when added later) always wins; bass hits are
 *     allowed to peak since there's no dialog yet.
 *
 * Sound design references: Apple's product-launch reel grammar
 * (whoosh → silence → boom → bright reveal), DaVinci Resolve's
 * "Motion Designer" SFX pack, and the Remotion promo for v4.
 */

export interface SfxEvent {
  at: number;
  file: string;
  volume?: number;
  /** Length in frames the <Sequence> stays alive (audio is clipped). */
  duration?: number;
  /** For documentation only — printed by the dev harness. */
  note?: string;
}

/**
 * Scene start frames (copied from SCENES in theme.ts — kept local so
 * the SFX module is self-documenting without a cross-import chain).
 */
const F = {
  intro:       0,
  tagline:     180,
  problem:     480,
  pipeline:    780,
  interpreter: 1200,
  voiceClone:  1680,
  pillMode:    2100,
  stats:       2520,
  pricing:     2880,
  cta:         3240,
  end:         3600,
};

export const SFX_TIMELINE: SfxEvent[] = [
  /* ─── Ambient bed — plays under everything ──────────────── */
  {
    at: F.intro,
    file: 'pad.wav',
    volume: 0.35,
    duration: F.end,
    note: 'Ambient drone spanning the full 60s',
  },

  /* ─── Scene 1 · IntroLogo (0–180) ───────────────────────── */
  {
    at: F.intro + 20,
    file: 'bass-drop.wav',
    volume: 0.85,
    note: 'Logo reveal — deep cinematic drop',
  },
  {
    at: F.intro + 85,
    file: 'sparkle.wav',
    volume: 0.6,
    note: 'Logo lockup twinkle',
  },

  /* ─── Scene 2 · Tagline (180–480) ───────────────────────── */
  {
    at: F.tagline,
    file: 'whoosh.wav',
    volume: 0.6,
    note: 'Cut into tagline',
  },
  // Typewriter clicks, ~1 per character of the key phrase. We stagger
  // them in a quick burst during the reveal; click volume is low so
  // they feel like background ticking, not a drumroll.
  ...Array.from({ length: 10 }).map((_, i) => ({
    at: F.tagline + 20 + i * 6,
    file: 'tick.wav',
    volume: 0.3,
    note: `Tagline type-tick ${i + 1}`,
  })),
  {
    at: F.tagline + 120,
    file: 'chime.wav',
    volume: 0.4,
    note: 'Tagline soft chime',
  },

  /* ─── Scene 3 · Problem (480–780) ───────────────────────── */
  {
    at: F.problem,
    file: 'whoosh-low.wav',
    volume: 0.7,
    note: 'Dark whoosh into the pain-point scene',
  },
  {
    at: F.problem + 60,
    file: 'heartbeat.wav',
    volume: 0.55,
    note: 'Tension build — heartbeat 1',
  },
  {
    at: F.problem + 160,
    file: 'heartbeat.wav',
    volume: 0.6,
    note: 'Tension build — heartbeat 2',
  },
  {
    at: F.problem + 260,
    file: 'boom.wav',
    volume: 0.8,
    note: 'Climax of the problem scene — emphatic boom',
  },

  /* ─── Scene 4 · Pipeline (780–1200) ─────────────────────── */
  {
    at: F.pipeline,
    file: 'whoosh.wav',
    volume: 0.6,
    note: 'Transition into the solution pipeline',
  },
  // Three successive UI clicks as the pipeline nodes activate.
  { at: F.pipeline +  50, file: 'click.wav', volume: 0.6, note: 'Pipeline node 1' },
  { at: F.pipeline + 130, file: 'click.wav', volume: 0.6, note: 'Pipeline node 2' },
  { at: F.pipeline + 210, file: 'click.wav', volume: 0.6, note: 'Pipeline node 3' },
  {
    at: F.pipeline + 300,
    file: 'sweep-up.wav',
    volume: 0.5,
    note: 'Ramp toward the 400 ms reveal',
  },
  {
    at: F.pipeline + 380,
    file: 'ding.wav',
    volume: 0.75,
    note: '400 ms number locks in — triumphant ding',
  },

  /* ─── Scene 5 · Interpreter (1200–1680) ─────────────────── */
  {
    at: F.interpreter,
    file: 'whoosh.wav',
    volume: 0.6,
  },
  // Subtle ticks during the live-transcript reveal (one per word).
  ...Array.from({ length: 14 }).map((_, i) => ({
    at: F.interpreter + 40 + i * 18,
    file: 'tick.wav',
    volume: 0.22,
    note: `Transcript word ${i + 1}`,
  })),
  {
    at: F.interpreter + 350,
    file: 'chime.wav',
    volume: 0.45,
    note: 'Translation appears',
  },

  /* ─── Scene 6 · VoiceClone (1680–2100) ──────────────────── */
  {
    at: F.voiceClone,
    file: 'whoosh.wav',
    volume: 0.55,
  },
  {
    at: F.voiceClone + 30,
    file: 'sparkle.wav',
    volume: 0.7,
    note: 'Voice clone magic — sparkle cluster',
  },
  // Tick per flag / language orbit (~5 flags).
  ...Array.from({ length: 5 }).map((_, i) => ({
    at: F.voiceClone + 100 + i * 40,
    file: 'tick.wav',
    volume: 0.35,
    note: `Clone flag orbit ${i + 1}`,
  })),
  {
    at: F.voiceClone + 320,
    file: 'chime.wav',
    volume: 0.5,
  },

  /* ─── Scene 7 · PillMode (2100–2520) ────────────────────── */
  {
    at: F.pillMode,
    file: 'whoosh.wav',
    volume: 0.55,
  },
  {
    at: F.pillMode + 30,
    file: 'click.wav',
    volume: 0.6,
    note: 'Pill docks at the edge of the screen',
  },
  {
    at: F.pillMode + 200,
    file: 'sparkle.wav',
    volume: 0.45,
    note: 'Pill idle shimmer',
  },

  /* ─── Scene 8 · Stats (2520–2880) ───────────────────────── */
  {
    at: F.stats,
    file: 'whoosh.wav',
    volume: 0.55,
  },
  // 4 counter ticks (one per stat), spaced 20 frames apart.
  { at: F.stats +  40, file: 'tick.wav', volume: 0.4 },
  { at: F.stats +  80, file: 'tick.wav', volume: 0.4 },
  { at: F.stats + 120, file: 'tick.wav', volume: 0.4 },
  { at: F.stats + 160, file: 'tick.wav', volume: 0.4 },
  {
    at: F.stats + 240,
    file: 'ding.wav',
    volume: 0.65,
    note: 'Final stats lock-in',
  },

  /* ─── Scene 9 · Pricing (2880–3240) ─────────────────────── */
  {
    at: F.pricing,
    file: 'whoosh.wav',
    volume: 0.55,
  },
  {
    at: F.pricing + 80,
    file: 'chime.wav',
    volume: 0.5,
    note: 'Pricing reveal — positive chime',
  },
  {
    at: F.pricing + 200,
    file: 'click.wav',
    volume: 0.5,
    note: 'Most-popular plan highlight',
  },

  /* ─── Scene 10 · FinalCTA (3240–3600) ───────────────────── */
  {
    at: F.cta,
    file: 'sweep-up.wav',
    volume: 0.55,
    note: 'Ramp into the CTA',
  },
  {
    at: F.cta + 40,
    file: 'bass-drop.wav',
    volume: 0.8,
    note: 'Button reveal impact',
  },
  {
    at: F.cta + 220,
    file: 'ding.wav',
    volume: 0.7,
    note: 'Closing ding — "you should click"',
  },
  {
    at: F.cta + 320,
    file: 'chime.wav',
    volume: 0.45,
    note: 'Outro — peaceful resolution',
  },
];
