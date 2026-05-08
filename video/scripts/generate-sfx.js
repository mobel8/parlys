/**
 * generate-sfx.js — procedural SFX synthesizer for the VoiceInk promo.
 *
 * Why procedural?
 *   1. Zero dependencies. Ships with Node's stdlib only.
 *   2. 100% royalty-free. We can re-use and redistribute without clearance.
 *   3. Reproducible. Same script → same bits, forever.
 *   4. Fast iteration. When the edit changes, we regenerate in < 2 s.
 *
 * What we produce:
 *   - `whoosh.wav`        — mid-freq airy transition (~500 ms)
 *   - `whoosh-low.wav`    — darker, dramatic transition (~650 ms)
 *   - `impact.wav`        — punchy kick + click (~300 ms)
 *   - `boom.wav`          — heavier sub-boom (~500 ms)
 *   - `chime.wav`         — bright bell with harmonic stack (~700 ms)
 *   - `click.wav`         — crisp UI click (~90 ms)
 *   - `tick.wav`          — tiny counter tick (~40 ms)
 *   - `ding.wav`          — triumphant upward ding (~450 ms)
 *   - `sweep-up.wav`      — ramping tension sweep (~900 ms)
 *   - `bass-drop.wav`     — cinematic sub-bass drop (~900 ms)
 *   - `sparkle.wav`       — magical twinkle cluster (~600 ms)
 *   - `heartbeat.wav`     — two-thump heartbeat (~650 ms)
 *   - `pad.wav`           — 60-second evolving ambient bed (mono, low)
 *
 * Output: d:/voiceink/video/public/sfx/*.wav (48 kHz mono 16-bit PCM).
 * Remotion's <Audio> resamples transparently, and 48 kHz is the Remotion
 * default internal rate — zero resampling cost.
 */

'use strict';
const fs = require('node:fs');
const path = require('node:path');

const SAMPLE_RATE = 48_000;
const OUT_DIR = path.join(__dirname, '..', 'public', 'sfx');
fs.mkdirSync(OUT_DIR, { recursive: true });

/* ─────────────────────────────────────────────────────────────
 * Tiny DSP primitives
 * ────────────────────────────────────────────────────────────*/

/** Fill `n` samples via a generator `f(t, i)` where t is seconds. */
function gen(n, f) {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) buf[i] = f(i / SAMPLE_RATE, i);
  return buf;
}

/** Apply a function sample-by-sample and mutate the buffer in place. */
function map(buf, f) {
  for (let i = 0; i < buf.length; i++) buf[i] = f(buf[i], i / SAMPLE_RATE, i);
  return buf;
}

/** Mix two equal-length buffers additively, clipped to [-1, 1]. */
function mix(...buffers) {
  const n = Math.max(...buffers.map((b) => b.length));
  const out = new Float32Array(n);
  for (const b of buffers) {
    for (let i = 0; i < b.length; i++) out[i] += b[i];
  }
  for (let i = 0; i < n; i++) out[i] = Math.max(-1, Math.min(1, out[i]));
  return out;
}

/** Exponential decay envelope: fully open at t=0, down to 0 at t=duration. */
function expDecay(t, duration, tau = 0.25) {
  if (t < 0 || t > duration) return 0;
  return Math.exp(-t / (duration * tau));
}

/** Raised-cosine (cosine) fade-in ramp over `duration`. */
function fadeIn(t, duration) {
  if (t <= 0) return 0;
  if (t >= duration) return 1;
  return 0.5 - 0.5 * Math.cos((Math.PI * t) / duration);
}

/** Raised-cosine fade-out ramp — 1 at t=0, 0 at t=duration. */
function fadeOut(t, duration) {
  return fadeIn(duration - t, duration);
}

/**
 * One-pole low-pass filter. `cutoff` is a coefficient 0–1 where higher
 * means "more of the new sample". A value of 0.15 gives a gentle
 * low-pass appropriate for taming noise bursts.
 */
function lowpass(buf, cutoff = 0.15) {
  let y = 0;
  for (let i = 0; i < buf.length; i++) {
    y = y + cutoff * (buf[i] - y);
    buf[i] = y;
  }
  return buf;
}

/**
 * One-pole high-pass filter — complement of the low-pass above. Useful
 * to add crispness to a click after a noise burst.
 */
function highpass(buf, cutoff = 0.5) {
  let y = 0, x1 = 0;
  for (let i = 0; i < buf.length; i++) {
    y = cutoff * (y + buf[i] - x1);
    x1 = buf[i];
    buf[i] = y;
  }
  return buf;
}

/** Pseudo-random noise in [-1, 1] with a deterministic seeded generator. */
function noise() {
  return Math.random() * 2 - 1;
}

/** Sine oscillator at frequency `f` (Hz). */
const sine = (t, f) => Math.sin(2 * Math.PI * f * t);

/** Triangle oscillator. Richer than sine, less harsh than square. */
const tri = (t, f) => {
  const p = (t * f) % 1;
  return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
};

/* ─────────────────────────────────────────────────────────────
 * WAV writer — 48 kHz, 16-bit PCM, mono.
 * ────────────────────────────────────────────────────────────*/

function writeWav(filename, floatBuffer) {
  // Normalise to ~0.92 peak so we keep ~0.7 dB of headroom.
  let peak = 0;
  for (let i = 0; i < floatBuffer.length; i++) {
    const a = Math.abs(floatBuffer[i]);
    if (a > peak) peak = a;
  }
  const scale = peak > 0 ? 0.92 / peak : 1;

  const pcm = Buffer.alloc(floatBuffer.length * 2);
  for (let i = 0; i < floatBuffer.length; i++) {
    const s = Math.max(-1, Math.min(1, floatBuffer[i] * scale));
    pcm.writeInt16LE(Math.round(s * 32767), i * 2);
  }

  const dataSize = pcm.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);                    // fmt chunk size
  header.writeUInt16LE(1, 20);                     // PCM
  header.writeUInt16LE(1, 22);                     // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);       // byte rate
  header.writeUInt16LE(2, 32);                     // block align
  header.writeUInt16LE(16, 34);                    // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  fs.writeFileSync(path.join(OUT_DIR, filename), Buffer.concat([header, pcm]));
  console.log(`  ✓ ${filename} (${(floatBuffer.length / SAMPLE_RATE).toFixed(2)} s, peak ${peak.toFixed(3)})`);
}

/* ─────────────────────────────────────────────────────────────
 * SFX recipes
 * ────────────────────────────────────────────────────────────*/

/**
 * Whoosh — filtered noise burst with a moving peak. The "swish" comes
 * from modulating the low-pass cutoff: it opens on the way in, closes
 * on the way out, giving a swooshing feel without a real band-pass.
 */
function makeWhoosh(durationMs = 500, intensity = 1) {
  const n = Math.floor((durationMs / 1000) * SAMPLE_RATE);
  const d = durationMs / 1000;
  let y = 0;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.sin(Math.PI * (t / d));   // hat envelope (slow in, slow out)
    const cutoff = 0.05 + 0.25 * env;           // cutoff follows env
    const x = noise() * intensity;
    y = y + cutoff * (x - y);                   // low-pass
    out[i] = y * env;
  }
  return out;
}

/**
 * Impact — a kick-like sub-punch with a click transient on top. The
 * sub is a sine sweep 120→40 Hz; the click is a 2-sample tick.
 */
function makeImpact(durationMs = 300) {
  const n = Math.floor((durationMs / 1000) * SAMPLE_RATE);
  const d = durationMs / 1000;
  const sub = gen(n, (t) => {
    const pitch = 120 - 80 * Math.min(1, t / (d * 0.3));
    return sine(t, pitch) * Math.exp(-t / (d * 0.25));
  });
  const click = gen(n, (t, i) => {
    if (i < 3) return noise() * 0.9;
    return 0;
  });
  const body = gen(n, (t) => {
    return sine(t, 60) * 0.3 * Math.exp(-t / (d * 0.4));
  });
  return mix(sub, body, click);
}

/**
 * Boom — heavier cousin of impact for dramatic moments. Lower freq,
 * longer tail, with a very short noise burst that simulates air
 * displacement.
 */
function makeBoom(durationMs = 500) {
  const n = Math.floor((durationMs / 1000) * SAMPLE_RATE);
  const d = durationMs / 1000;
  const sub = gen(n, (t) => {
    const pitch = 90 - 60 * Math.min(1, t / (d * 0.4));
    return sine(t, pitch) * Math.exp(-t / (d * 0.35));
  });
  const rumble = gen(n, (t) => {
    return sine(t, 40) * 0.25 * Math.exp(-t / (d * 0.5));
  });
  const air = gen(n, (t, i) => {
    if (i > SAMPLE_RATE * 0.02) return 0;
    return noise() * 0.4 * (1 - i / (SAMPLE_RATE * 0.02));
  });
  return mix(sub, rumble, air);
}

/**
 * Chime — bright bell with a sparkly harmonic stack. We combine three
 * sine oscillators at harmonic intervals (1, 2.76, 5.4 — approximating
 * a struck-metal overtone ratio).
 */
function makeChime(durationMs = 700) {
  const n = Math.floor((durationMs / 1000) * SAMPLE_RATE);
  const d = durationMs / 1000;
  const base = 880; // A5
  const partials = [
    { f: base * 1,    a: 0.6, decay: 0.4 },
    { f: base * 2.76, a: 0.3, decay: 0.25 },
    { f: base * 5.4,  a: 0.15, decay: 0.15 },
  ];
  return gen(n, (t) => {
    let s = 0;
    for (const p of partials) s += sine(t, p.f) * p.a * Math.exp(-t / (d * p.decay));
    return s;
  });
}

/** Click — crisp short tick with a touch of sub thickness. */
function makeClick(durationMs = 90) {
  const n = Math.floor((durationMs / 1000) * SAMPLE_RATE);
  const d = durationMs / 1000;
  const tick = gen(n, (t, i) => {
    if (i < 5) return noise() * 1;
    return 0;
  });
  const body = gen(n, (t) => sine(t, 2200) * Math.exp(-t / (d * 0.15)) * 0.5);
  const thud = gen(n, (t) => sine(t, 220) * Math.exp(-t / (d * 0.2)) * 0.2);
  return highpass(mix(tick, body, thud), 0.6);
}

/** Tick — tiny, short counter tick. Used per digit of a number counter. */
function makeTick(durationMs = 40) {
  const n = Math.floor((durationMs / 1000) * SAMPLE_RATE);
  const d = durationMs / 1000;
  return gen(n, (t, i) => {
    const env = Math.exp(-t / (d * 0.2));
    return (sine(t, 3200) + noise() * 0.3) * env * 0.5;
  });
}

/**
 * Ding — triumphant upward sweep ending on a bright chime. Good for
 * the final reveal of a big number or CTA.
 */
function makeDing(durationMs = 450) {
  const n = Math.floor((durationMs / 1000) * SAMPLE_RATE);
  const d = durationMs / 1000;
  return gen(n, (t) => {
    const sweep = 660 + 440 * Math.min(1, t / (d * 0.3));
    const base = sine(t, sweep) * Math.exp(-t / (d * 0.4));
    const harm = sine(t, sweep * 2) * 0.4 * Math.exp(-t / (d * 0.25));
    return base + harm;
  });
}

/**
 * Sweep-up — rising tension buildup. Pitch sweeps from 100 Hz to 800 Hz
 * with intensifying noise to simulate air pressure mounting.
 */
function makeSweepUp(durationMs = 900) {
  const n = Math.floor((durationMs / 1000) * SAMPLE_RATE);
  const d = durationMs / 1000;
  const tone = gen(n, (t) => {
    const k = Math.min(1, t / d);
    const f = 100 + 700 * (k * k); // quadratic ramp for dramatic buildup
    return sine(t, f) * fadeIn(t, d * 0.2) * fadeOut(t, d * 0.05);
  });
  const air = gen(n, (t) => {
    const env = Math.pow(Math.min(1, t / d), 1.8);
    return noise() * env * 0.35;
  });
  return lowpass(mix(tone, air), 0.3);
}

/**
 * Bass-drop — dramatic sub-bass plunge. Pitch drops 200 → 30 Hz over
 * 400 ms then settles into a rumble. Great on "moment of impact" cuts.
 */
function makeBassDrop(durationMs = 900) {
  const n = Math.floor((durationMs / 1000) * SAMPLE_RATE);
  const d = durationMs / 1000;
  return gen(n, (t) => {
    const k = Math.min(1, t / (d * 0.45));
    const pitch = 200 * Math.pow(0.15, k); // exponential plunge to ~30 Hz
    const env =
      t < d * 0.45 ? fadeIn(t, 0.02)
      : Math.exp(-(t - d * 0.45) / (d * 0.35));
    const body = sine(t, pitch) * env;
    const sub = sine(t, pitch * 0.5) * 0.4 * env;
    return body + sub;
  });
}

/**
 * Sparkle — cluster of 5 short high-frequency tones randomly staggered.
 * Used to evoke "magic" moments (the voice clone reveal, stats lock-in).
 */
function makeSparkle(durationMs = 600) {
  const n = Math.floor((durationMs / 1000) * SAMPLE_RATE);
  const d = durationMs / 1000;
  const seeds = [
    { f: 1760,  offset: 0.00, decay: 0.25 },
    { f: 2093,  offset: 0.08, decay: 0.20 },
    { f: 2637,  offset: 0.15, decay: 0.18 },
    { f: 3136,  offset: 0.22, decay: 0.16 },
    { f: 3951,  offset: 0.32, decay: 0.14 },
  ];
  const sum = new Float32Array(n);
  for (const s of seeds) {
    for (let i = 0; i < n; i++) {
      const t = i / SAMPLE_RATE - s.offset;
      if (t < 0 || t > d) continue;
      sum[i] += sine(t, s.f) * Math.exp(-t / (d * s.decay)) * 0.25;
    }
  }
  return sum;
}

/**
 * Heartbeat — two impact thumps, 150 ms apart, lub-dub. Adds urgency to
 * the problem scene without being cheesy.
 */
function makeHeartbeat() {
  const lub = makeImpact(180);
  const dub = makeImpact(220);
  const gap = Math.floor(0.15 * SAMPLE_RATE);
  const n = lub.length + gap + dub.length;
  const out = new Float32Array(n);
  for (let i = 0; i < lub.length; i++) out[i] += lub[i] * 0.9;
  for (let i = 0; i < dub.length; i++) out[i + lub.length + gap] += dub[i] * 0.7;
  return out;
}

/**
 * Ambient pad — 60-second evolving bed. Built from:
 *   - A low fundamental (110 Hz A2) with a slow LFO'd pitch detune
 *   - Two quiet 5ths (165 Hz, 220 Hz) offset in phase for width
 *   - A sparse, very quiet shimmer of random high partials
 *
 * Volume is deliberately low — it shouldn't compete with scene SFX.
 */
function makeAmbientPad() {
  const duration = 62; // seconds, slightly longer than the video
  const n = duration * SAMPLE_RATE;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    // Slow LFO for subtle pitch shimmer (0.05 Hz = 20s period)
    const lfo = 1 + 0.004 * Math.sin(2 * Math.PI * 0.05 * t);
    const env = fadeIn(t, 2.5) * fadeOut(t, 2.5);
    const root  = sine(t, 110 * lfo) * 0.22;
    const fifth = sine(t, 165 * lfo) * 0.12;
    const oct   = sine(t, 220 * lfo) * 0.08;
    out[i] = (root + fifth + oct) * env;
  }
  // Soft low-pass so it sits far behind the SFX layer.
  return lowpass(out, 0.10);
}

/* ─────────────────────────────────────────────────────────────
 * Render all SFX files
 * ────────────────────────────────────────────────────────────*/

console.log('→ Synthesising SFX to', OUT_DIR);

writeWav('whoosh.wav',       makeWhoosh(500));
writeWav('whoosh-low.wav',   makeWhoosh(650, 1.1));
writeWav('impact.wav',       makeImpact(300));
writeWav('boom.wav',          makeBoom(600));
writeWav('chime.wav',         makeChime(800));
writeWav('click.wav',         makeClick(90));
writeWav('tick.wav',          makeTick(45));
writeWav('ding.wav',          makeDing(500));
writeWav('sweep-up.wav',      makeSweepUp(1000));
writeWav('bass-drop.wav',     makeBassDrop(900));
writeWav('sparkle.wav',       makeSparkle(700));
writeWav('heartbeat.wav',     makeHeartbeat());
writeWav('pad.wav',           makeAmbientPad());

console.log('✓ Done');
