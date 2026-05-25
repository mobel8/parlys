// ElevenLabs Flash v2.5 — HTTP chunked streaming TTS.
//
// WHY Flash v2.5 and not Turbo v2.5?
//   Flash is tuned for low TTFB (~75 ms reported, ~150-250 ms in
//   practice on EU connections) while Turbo optimises for overall
//   throughput. For an interpreter the first-audio latency matters
//   more than the tail, so Flash wins.
//
// Protocol (as of 2025):
//   POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream
//   Headers:
//     xi-api-key: <key>
//     Accept: audio/mpeg
//   Body (JSON):
//     { text, model_id, voice_settings?, output_format?, language_code? }
//   Response: chunked MP3 stream.
//
// All three providers in our fleet deliver MP3 so the renderer has a
// single playback path (MediaSource with 'audio/mpeg').

import { TTSChunk, TTSStreamOptions } from './index';

const BASE = process.env.VOICEINK_ELEVENLABS_URL || 'https://api.elevenlabs.io';
const ENDPOINT = (voiceId: string) =>
  `${BASE}/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream`;

/** Languages Flash v2.5 supports. 32 languages as of late 2024. */
const SUPPORTED_LANGS = new Set([
  'en', 'fr', 'de', 'es', 'it', 'pt', 'pl', 'nl', 'ru', 'tr',
  'ja', 'zh', 'ko', 'ar', 'hi', 'id', 'ro', 'sv', 'da', 'no',
  'fi', 'uk', 'cs', 'sk', 'hu', 'bg', 'hr', 'el', 'he', 'ms',
  'ta', 'vi',
]);

export async function* streamElevenLabs(
  apiKey: string,
  opts: TTSStreamOptions,
): AsyncGenerator<TTSChunk, void, void> {
  const text = (opts.text || '').trim();
  if (!text) return;

  const voiceId = opts.voiceId || '21m00Tcm4TlvDq8ikWAM'; // Rachel
  const speed = clampSpeed(opts.speed);
  const langCode = opts.language && SUPPORTED_LANGS.has(opts.language.toLowerCase())
    ? opts.language.toLowerCase()
    : undefined;

  const body: Record<string, unknown> = {
    text,
    model_id: 'eleven_flash_v2_5',
    voice_settings: {
      stability: 0.45,
      similarity_boost: 0.75,
      style: 0.0,
      use_speaker_boost: true,
      speed,
    },
    output_format: 'mp3_44100_128',
  };
  if (langCode) body.language_code = langCode;

  const res = await fetch(ENDPOINT(voiceId), {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!res.ok) {
    let detail = '';
    try { detail = await res.text(); } catch { /* ignore */ }
    throw new Error(
      `ElevenLabs ${res.status} ${res.statusText}${detail ? ' — ' + detail.slice(0, 300) : ''}`,
    );
  }
  if (!res.body) {
    throw new Error('ElevenLabs: empty response body');
  }

  const reader = res.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      if (value && value.byteLength > 0) {
        // Web ReadableStream yields Uint8Array; wrap in Node Buffer so
        // the downstream (renderer) gets a familiar base64 path without
        // an extra copy.
        yield { chunk: Buffer.from(value), mime: 'audio/mpeg' };
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
}

function clampSpeed(x: number | undefined): number {
  if (typeof x !== 'number' || !Number.isFinite(x)) return 1.0;
  // ElevenLabs accepts 0.7 – 1.2 on Flash v2.5; be lenient, clamp here.
  return Math.min(1.2, Math.max(0.7, x));
}
