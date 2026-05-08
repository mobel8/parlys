/**
 * Provider broker — outbound HTTP calls to Groq / Cartesia / ElevenLabs / OpenAI.
 *
 * All upstream calls go through here so we can:
 *   - Inject OUR API keys (the user doesn't see them).
 *   - Support BYOK via request headers when the plan allows it.
 *   - Normalise error shapes (every provider has a different error envelope).
 *   - Measure upstream latency for SLO dashboards.
 *
 * No caching: the inputs (audio blobs, translation strings) are unique per
 * call, so caching buys us nothing and adds a privacy concern.
 */
// Uses Node 22's global `fetch` + `FormData` — no undici import needed.
// This keeps the body-type plumbing simple (native FormData is assignable
// to fetch's BodyInit without casts, which undici.request doesn't support).
import { env } from './env.js';

/** Per-user override of provider keys, set when the user opts into BYOK. */
export interface ProviderKeys {
  groq?: string;
  cartesia?: string;
  elevenlabs?: string;
  openai?: string;
}

function keyOr(userKey: string | undefined, ourKey: string, name: string): string {
  const k = userKey || ourKey;
  if (!k) {
    throw new Error(`missing ${name} API key (configure ${name.toUpperCase()}_API_KEY on the server)`);
  }
  return k;
}

export interface TranscribeArgs {
  audio: Buffer;
  mimeType: string;
  language?: string;      // 'auto' | ISO-639-1
  /** Groq model to use. Default is whisper-large-v3-turbo (fastest + accurate). */
  model?: string;
}

export interface TranscribeResult {
  text: string;
  language?: string;
  /** Upstream-reported duration of the audio in seconds. Used for billing. */
  durationSec: number;
  upstreamMs: number;
}

/** POST /openai/v1/audio/transcriptions on Groq. Streaming isn't needed
 *  here — Whisper returns the full transcript in one JSON payload. */
export async function transcribe(args: TranscribeArgs, keys: ProviderKeys = {}): Promise<TranscribeResult> {
  const key = keyOr(keys.groq, env.groqApiKey, 'groq');
  const model = args.model || 'whisper-large-v3-turbo';
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(args.audio)], { type: args.mimeType }), 'audio');
  form.append('model', model);
  form.append('response_format', 'verbose_json');
  if (args.language && args.language !== 'auto') {
    form.append('language', args.language);
  }

  const t0 = Date.now();
  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}` },
    body: form,
  });
  const upstreamMs = Date.now() - t0;

  if (!res.ok) {
    const bodyText = await res.text();
    throw new Error(`groq transcribe ${res.status}: ${bodyText.slice(0, 400)}`);
  }
  const json: any = await res.json();
  return {
    text: String(json.text ?? '').trim(),
    language: json.language ? String(json.language).toLowerCase() : undefined,
    durationSec: Number(json.duration ?? 0),
    upstreamMs,
  };
}

export interface TranslateArgs {
  text: string;
  targetLang: string;
  sourceLang?: string;
}

export async function translate(args: TranslateArgs, keys: ProviderKeys = {}): Promise<{
  text: string;
  upstreamMs: number;
}> {
  const key = keyOr(keys.groq, env.groqApiKey, 'groq');
  const system = `Translate user input to ${args.targetLang}. Output translation only, no prefix, no quotes.`;
  const t0 = Date.now();
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: args.text },
      ],
    }),
  });
  const upstreamMs = Date.now() - t0;
  if (!res.ok) {
    throw new Error(`groq translate ${res.status}: ${await res.text()}`);
  }
  const json: any = await res.json();
  const text = String(json.choices?.[0]?.message?.content ?? '').trim();
  return { text, upstreamMs };
}

export interface SpeakArgs {
  text: string;
  voiceId: string;
  language?: string;
  /** 'cartesia' (default, cheapest+fastest) or 'elevenlabs' (premium). */
  provider?: 'cartesia' | 'elevenlabs' | 'openai';
}

/**
 * Streams MP3 chunks back to the caller via an async iterable. The route
 * handler can then pipe these straight into a Fastify reply, so the
 * renderer gets the first audio byte in < 250 ms typical.
 */
export async function* speakStream(args: SpeakArgs, keys: ProviderKeys = {}): AsyncGenerator<Uint8Array, { upstreamMs: number; durationSec: number }> {
  const provider = args.provider || 'cartesia';
  const t0 = Date.now();
  let durationSec = 0;

  async function* streamBody(res: Response) {
    const reader = res.body?.getReader();
    if (!reader) return;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) yield value;
    }
  }

  if (provider === 'cartesia') {
    const key = keyOr(keys.cartesia, env.cartesiaApiKey, 'cartesia');
    const res = await fetch('https://api.cartesia.ai/tts/bytes', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-API-Key': key,
        'Cartesia-Version': '2024-06-10',
      },
      body: JSON.stringify({
        model_id: 'sonic-english',
        transcript: args.text,
        voice: { mode: 'id', id: args.voiceId },
        output_format: { container: 'mp3', bit_rate: 64_000, sample_rate: 44_100 },
        language: args.language || 'en',
      }),
    });
    if (!res.ok) throw new Error(`cartesia speak ${res.status}: ${await res.text()}`);
    // Rough heuristic: 1 char ≈ 0.06s of speech at normal pace.
    durationSec = Math.max(1, args.text.length * 0.06);
    for await (const chunk of streamBody(res)) yield chunk;
  } else if (provider === 'elevenlabs') {
    const key = keyOr(keys.elevenlabs, env.elevenlabsApiKey, 'elevenlabs');
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(args.voiceId)}/stream`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'xi-api-key': key,
        accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: args.text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        output_format: 'mp3_44100_64',
      }),
    });
    if (!res.ok) throw new Error(`elevenlabs speak ${res.status}: ${await res.text()}`);
    durationSec = Math.max(1, args.text.length * 0.06);
    for await (const chunk of streamBody(res)) yield chunk;
  } else {
    // OpenAI TTS fallback — cheapest for free tier.
    const key = keyOr(keys.openai, env.openaiApiKey, 'openai');
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'tts-1',
        voice: args.voiceId,
        input: args.text,
        response_format: 'mp3',
        speed: 1.0,
      }),
    });
    if (!res.ok) throw new Error(`openai speak ${res.status}: ${await res.text()}`);
    durationSec = Math.max(1, args.text.length * 0.06);
    for await (const chunk of streamBody(res)) yield chunk;
  }

  return { upstreamMs: Date.now() - t0, durationSec };
}
