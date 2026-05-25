// OpenAI gpt-4o-mini-tts — HTTP streaming TTS.
//
// As of late 2024 the `/v1/audio/speech` endpoint streams MP3 bytes in
// chunked transfer when `response_format: 'mp3'` is requested and a
// streaming-capable model is used. First audio byte arrives ~200-400 ms
// after the POST for short utterances on the default US region.
//
// Protocol:
//   POST https://api.openai.com/v1/audio/speech
//   Headers: Authorization: Bearer <key>
//   Body (JSON):
//     { model, voice, input, response_format?, speed? }
//   Response: chunked MP3 stream.
//
// All three providers in our fleet deliver MP3 so the renderer has a
// single playback path (MediaSource with 'audio/mpeg').

import { TTSChunk, TTSStreamOptions } from './index';

const ENDPOINT = process.env.VOICEINK_OPENAI_TTS_URL || 'https://api.openai.com/v1/audio/speech';

/** Built-in voices for gpt-4o-mini-tts. */
const KNOWN_VOICES = new Set([
  'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova',
  'onyx', 'sage', 'shimmer', 'verse',
]);

export async function* streamOpenAI(
  apiKey: string,
  opts: TTSStreamOptions,
): AsyncGenerator<TTSChunk, void, void> {
  const text = (opts.text || '').trim();
  if (!text) return;

  const voice = opts.voiceId && KNOWN_VOICES.has(opts.voiceId)
    ? opts.voiceId
    : 'alloy';
  const speed = clampSpeed(opts.speed);

  const body: Record<string, unknown> = {
    model: 'gpt-4o-mini-tts',
    voice,
    input: text,
    response_format: 'mp3',
    speed,
  };

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
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
      `OpenAI TTS ${res.status} ${res.statusText}${detail ? ' — ' + detail.slice(0, 300) : ''}`,
    );
  }
  if (!res.body) {
    throw new Error('OpenAI TTS: empty response body');
  }

  const reader = res.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      if (value && value.byteLength > 0) {
        yield { chunk: Buffer.from(value), mime: 'audio/mpeg' };
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
}

function clampSpeed(x: number | undefined): number {
  if (typeof x !== 'number' || !Number.isFinite(x)) return 1.0;
  // OpenAI accepts 0.25 – 4.0 but quality degrades outside 0.75–1.25.
  return Math.min(4.0, Math.max(0.25, x));
}
