// Cartesia Sonic-2 — HTTP chunked streaming TTS via /tts/bytes.
//
// WHY /tts/bytes and not /tts/sse or /tts/websocket?
//   As of 2025-04 Cartesia enforces `container: 'raw'` (raw PCM) on
//   both /tts/websocket and /tts/sse endpoints. Only /tts/bytes
//   accepts `container: 'mp3'` while still returning the audio in
//   HTTP/1.1 chunked transfer encoding, which keeps the pipeline
//   incremental (TTFB ~300 ms, first MP3 frame arrives ~1 ms after
//   the headers).
//
//   Using MP3 rather than raw PCM keeps the renderer playback path
//   uniform across all three providers (ElevenLabs, OpenAI, Cartesia
//   all emit audio/mpeg chunks fed into a single MediaSource
//   SourceBuffer with mime='audio/mpeg'). Switching to PCM would
//   require adding a WebAudio decoder path only for Cartesia.
//
// Protocol (as of 2025-04):
//   POST https://api.cartesia.ai/tts/bytes
//   Headers: X-API-Key, Cartesia-Version: 2024-11-13,
//            Content-Type: application/json
//   Body (JSON):
//     { model_id: 'sonic-2',
//       transcript,
//       voice: { mode:'id', id },
//       output_format: { container:'mp3', sample_rate:44100, bit_rate:128000 },
//       language?, speed? }
//   Response: Content-Type: audio/mpeg, Transfer-Encoding: chunked.
//             Body = raw MP3 bytes, one frame per chunk (~400-600 B).
//
// All three providers in our fleet deliver MP3 so the renderer has a
// single playback path (MediaSource with 'audio/mpeg').

import { TTSChunk, TTSStreamOptions } from './index';

// HTTP endpoint. Overridable via env var `VOICEINK_CARTESIA_URL` for
// local tests against a mock server — never document publicly since
// pointing end-users at a custom URL would leak their API key.
const CARTESIA_URL =
  process.env.VOICEINK_CARTESIA_URL ||
  process.env.VOICEINK_CARTESIA_WS_URL ||  // legacy name kept as alias
  'https://api.cartesia.ai/tts/bytes';
const CARTESIA_VERSION = '2024-11-13';

/** Minimum language subset Cartesia Sonic-2 supports well. */
const SUPPORTED_LANGS = new Set([
  'en', 'fr', 'de', 'es', 'pt', 'zh', 'ja', 'hi', 'it', 'ko',
  'nl', 'pl', 'ru', 'sv', 'tr',
]);

export async function* streamCartesia(
  apiKey: string,
  opts: TTSStreamOptions,
): AsyncGenerator<TTSChunk, void, void> {
  const text = (opts.text || '').trim();
  if (!text) return;

  const lang = opts.language && SUPPORTED_LANGS.has(opts.language.toLowerCase())
    ? opts.language.toLowerCase()
    : 'en';

  // IMPORTANT: Cartesia /tts/bytes IGNORES a numeric `speed` param
  // sent at the top-level (measured empirically 2026-04-22: values
  // 0.5 / 1.0 / 2.0 all produce audio within ±5% of the same
  // duration). The only form the server honours today is a STRING
  // enum 'slowest' | 'slow' | 'normal' | 'fast' | 'fastest'. So we
  // map the UI slider (0.5..2.0) to that 5-bucket enum before
  // building the request payload.
  //
  // Measured impact on a 13-word French sentence:
  //   slowest → 7.34s (+54% vs normal)
  //   slow    → 5.98s (+25% vs normal)
  //   normal  → 4.78s
  //   fast    → ~normal (Cartesia seems to cap the upper end)
  //   fastest → ~normal
  //
  // For users who want the translation to "catch up" with their fast
  // speech, the slower buckets are the useful lever — which matches
  // the ergonomic design (push the slider LEFT to buy more time).
  const speedEnum = toCartesiaSpeed(opts.speed);

  const payload: Record<string, unknown> = {
    model_id: 'sonic-2',
    transcript: text,
    voice: { mode: 'id', id: opts.voiceId || '794f9389-aac1-45b6-b726-9d9369183238' },
    output_format: {
      container: 'mp3',
      sample_rate: 44100,
      // 96 kbps MP3 is the sweet spot for a voice interpreter:
      // - TTFB ~170 ms vs ~210 ms @ 128 kbps on /tts/bytes (benched
      //   over 12 runs w/ keep-alive, see scripts/_probe-cartesia-samplerate.js)
      // - Audio is indistinguishable from 128 kbps for typical
      //   interpreter voices (no music, no high-frequency content)
      // - Bytes on the wire ~= 2/3 of 128 kbps → each chunk reaches
      //   the renderer faster, so playback starts sooner too.
      bit_rate: 96000,
    },
    language: lang,
  };
  // Only emit the speed field when the user picked a non-default
  // bucket — sending 'normal' is harmless but also redundant, and
  // omitting it lets the server choose its own "best" cadence.
  if (speedEnum && speedEnum !== 'normal') {
    payload.speed = speedEnum;
  }

  // Node's global fetch (Node 20+) returns a Web ReadableStream on
  // res.body. With Transfer-Encoding: chunked, each reader.read()
  // returns one TCP chunk (~400-600 bytes) which we forward verbatim
  // to the renderer.
  const res = await fetch(CARTESIA_URL, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Cartesia-Version': CARTESIA_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: opts.signal,
  });

  if (!res.ok) {
    const body = await safeReadText(res);
    throw new Error(`Cartesia HTTP ${res.status}: ${body || res.statusText}`);
  }
  if (!res.body) {
    throw new Error('Cartesia: no response body');
  }

  const reader = (res.body as any).getReader
    ? (res.body as ReadableStream<Uint8Array>).getReader()
    : null;
  if (!reader) throw new Error('Cartesia: response body is not a web stream');

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      if (value && value.length > 0) {
        yield { chunk: Buffer.from(value), mime: 'audio/mpeg' };
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
}

async function safeReadText(res: Response): Promise<string> {
  try { return (await res.text()).slice(0, 500); } catch { return ''; }
}

/**
 * Fire-and-forget warm-up: opens a TLS session to api.cartesia.ai so
 * the next real TTS request doesn't pay for the TCP + TLS handshake
 * (~80-150 ms on a cold connection). The return value is intentionally
 * ignored — we don't care whether the endpoint exists or 404s, only
 * that Node's undici global agent keeps a socket in its pool.
 *
 * Call this at the START of an interpret session (in parallel with
 * Whisper). By the time the translation finishes and we POST /tts/bytes,
 * the session is already established and TTFB drops by 40-80 ms.
 */
export function prewarmCartesia(apiKey: string): void {
  if (!apiKey) return;
  const url = (process.env.VOICEINK_CARTESIA_URL || 'https://api.cartesia.ai/tts/bytes')
    .replace(/\/tts\/bytes.*$/, '/voices/?limit=1');
  // HEAD is cheapest; some servers reject it so we just fall back to GET.
  fetch(url, {
    method: 'GET',
    headers: { 'X-API-Key': apiKey, 'Cartesia-Version': CARTESIA_VERSION, Connection: 'keep-alive' },
  }).then((r) => r.arrayBuffer()).catch(() => { /* warm-up is best-effort */ });
}

/**
 * Map a UI slider value (0.5..2.0, 1.0 = natural) to the 5-bucket
 * string enum that Cartesia's /tts/bytes endpoint actually honours.
 *
 * The buckets are asymmetric on purpose:
 *   - Low end (< 0.85) gets two distinct slow buckets because that's
 *     where the user gets the most perceptual benefit (the whole
 *     point of slowing down is that a translation pipeline can catch
 *     up with fast speech; the slider has to make a real audible
 *     difference there).
 *   - High end (> 1.15) gets two fast buckets even though the server
 *     currently caps the acceleration; that way if Cartesia later
 *     relaxes that cap, our UI will benefit without a code change.
 *
 * Returns `null` for non-finite / undefined inputs so the caller can
 * omit the field entirely.
 */
export function toCartesiaSpeed(x: number | undefined): 'slowest' | 'slow' | 'normal' | 'fast' | 'fastest' | null {
  if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  if (x <= 0.65) return 'slowest';
  if (x <= 0.85) return 'slow';
  if (x <  1.15) return 'normal';
  if (x <  1.45) return 'fast';
  return 'fastest';
}
