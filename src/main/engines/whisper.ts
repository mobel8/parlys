// Groq Whisper transcription engine.
// Uses the OpenAI-compatible audio/transcriptions endpoint hosted by Groq.
// Whisper-large-v3-turbo is near real-time (~200-400ms for a few seconds of audio).

import { Settings } from '../../shared/types';

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';

export interface WhisperResult {
  text: string;
  language?: string;
}

export async function transcribeWithGroq(
  audio: Buffer,
  mimeType: string,
  settings: Settings,
): Promise<WhisperResult> {
  if (!settings.groqApiKey) {
    throw new Error(
      'Clé API Groq manquante. Ouvrez Paramètres et collez votre clé (gsk_...).',
    );
  }

  // Infer a filename extension from the mime type. Groq rejects unknown names.
  const ext = mimeToExt(mimeType);
  const filename = `audio.${ext}`;

  const form = new FormData();
  // Convert Node Buffer to a Uint8Array backed by a plain ArrayBuffer
  // (avoids TS complaint about SharedArrayBuffer in newer @types/node).
  const ab = new ArrayBuffer(audio.length);
  new Uint8Array(ab).set(audio);
  const blob = new Blob([ab], { type: mimeType });
  form.append('file', blob, filename);
  form.append('model', settings.sttModel || 'whisper-large-v3-turbo');
  form.append('response_format', 'json');
  form.append('temperature', '0');
  if (settings.language && settings.language !== 'auto') {
    form.append('language', settings.language);
  }

  const res = await fetch(GROQ_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.groqApiKey}` },
    body: form as any,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Groq ${res.status} ${res.statusText} — ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { text: string; language?: string };
  return { text: (data.text || '').trim(), language: data.language };
}

function mimeToExt(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes('webm')) return 'webm';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('mp4')) return 'mp4';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('wav')) return 'wav';
  if (m.includes('m4a')) return 'm4a';
  if (m.includes('flac')) return 'flac';
  return 'webm';
}
