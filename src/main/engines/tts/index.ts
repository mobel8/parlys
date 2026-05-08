// TTS engine dispatcher — hides provider-specific plumbing behind a
// single streaming interface. Each provider module exports a
// `stream<Provider>` function that returns an async iterable of MP3
// chunks. The interpreter IPC handler feeds those chunks back to the
// renderer which plays them via MediaSource in near-real time.
//
// Contract for every provider:
//   - Input  : utf-8 text to speak, voice id, language hint, speed.
//   - Output : async iterable of { chunk: Buffer, mime: string }.
//              The caller pipes each chunk to the renderer as soon as
//              it arrives — NO provider buffers the full utterance.
//   - Errors : throw with a human-readable message. The handler turns
//              it into an InterpretResponse with ok=false and the
//              renderer surfaces the error to the user.

import { Settings, TTSProvider } from '../../../shared/types';
import { streamCartesia } from './cartesia';
import { streamElevenLabs } from './elevenlabs';
import { streamOpenAI } from './openai';

export interface TTSStreamOptions {
  text: string;
  /** ISO 639-1. Some providers ignore it (ElevenLabs auto-detects). */
  language?: string;
  /** Provider-specific voice id. Falls back to provider default if empty. */
  voiceId?: string;
  /** 0.5 – 2.0 multiplier. 1.0 = natural. */
  speed?: number;
  /** Abort signal so callers can cancel an in-flight stream. */
  signal?: AbortSignal;
}

export interface TTSChunk {
  chunk: Buffer;
  mime: string; // always 'audio/mpeg' in our setup
}

/**
 * Dispatch to the configured TTS provider. Streams MP3 chunks as they
 * arrive. The first chunk should land in <300ms for all three providers
 * with a cold HTTPS/WS handshake.
 */
export async function* streamTTS(
  settings: Settings,
  text: string,
  opts: Omit<TTSStreamOptions, 'text'> = {},
): AsyncGenerator<TTSChunk, void, void> {
  const provider: TTSProvider = settings.ttsProvider || 'cartesia';
  const apiKey = settings.ttsApiKey?.[provider] || '';
  const voiceId = opts.voiceId || settings.ttsVoiceId?.[provider] || '';
  const speed = typeof opts.speed === 'number' ? opts.speed : (settings.ttsSpeed ?? 1.0);

  const fullOpts: TTSStreamOptions = {
    text,
    language: opts.language,
    voiceId,
    speed,
    signal: opts.signal,
  };

  if (!apiKey) {
    throw new Error(
      `Clé API ${provider} manquante. Ouvrez Paramètres → Traducteur vocal et collez votre clé.`,
    );
  }

  switch (provider) {
    case 'cartesia':
      yield* streamCartesia(apiKey, fullOpts);
      return;
    case 'elevenlabs':
      yield* streamElevenLabs(apiKey, fullOpts);
      return;
    case 'openai':
      yield* streamOpenAI(apiKey, fullOpts);
      return;
    default:
      throw new Error(`Unknown TTS provider: ${provider as string}`);
  }
}
