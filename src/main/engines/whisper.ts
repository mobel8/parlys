// Groq Whisper transcription engine.
// Uses the OpenAI-compatible audio/transcriptions endpoint hosted by Groq.
// Whisper-large-v3-turbo is near real-time (~200-400ms for a few seconds of audio).

import { Settings } from '../../shared/types';

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';

/**
 * Default vocabulary-biasing prompts per language.
 *
 * Whisper's `prompt` parameter (up to 224 tokens) makes the model imitate the
 * style + vocabulary of the prompt — it's NOT an instruction. So the prompt
 * must be a sample "exemplary transcription" in the target language, with
 * proper casing, punctuation and accents, plus the technical/brand names the
 * user is likely to dictate. Whisper then biases toward those spellings:
 * "VoiceInk" stays "VoiceInk" instead of slipping to "Voice Inc.", "API"
 * stays uppercase, French accents render correctly, etc.
 *
 * Note: prompt MUST be in the same language as the audio, otherwise it
 * degrades accuracy (Whisper code-switches to the prompt's language).
 */
const DEFAULT_PROMPTS: Record<string, string> = {
  fr:
    "Transcription française précise avec ponctuation et accents corrects (é, è, à, ç, ù, ï). " +
    "Vocabulaire technique courant : VoiceInk, API, MCP, LLM, GPT, Claude, Anthropic, OpenAI, " +
    "Groq, Whisper, TypeScript, JavaScript, Node.js, React, Vite, Electron, GitHub, VS Code, " +
    "prompt, token, endpoint, webhook, frontend, backend, npm, async, await, callback, JSON, " +
    "Chrome DevTools, console, IPC, render, build, debug, refactor.",
  en:
    "Accurate English transcription with correct punctuation and capitalisation. " +
    "Common technical vocabulary: VoiceInk, API, MCP, LLM, GPT, Claude, Anthropic, OpenAI, " +
    "Groq, Whisper, TypeScript, JavaScript, Node.js, React, Vite, Electron, GitHub, VS Code, " +
    "prompt, token, endpoint, webhook, frontend, backend, npm, async, await, callback, JSON.",
};

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

  // A multipart FormData body is consumed when sent, so build a fresh one
  // per attempt (cheap — the audio buffer is just re-wrapped in a Blob).
  const buildForm = (): FormData => {
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
    // Vocabulary biasing — see DEFAULT_PROMPTS above for the why. We pick the
    // prompt based on the explicit/forced language; for 'auto' we skip it
    // because guessing wrong-language prompt actively hurts accuracy.
    // settings.sttPrompt (if set by the user) overrides the built-in default.
    const promptLang = (settings.language || '').toLowerCase();
    const customPrompt = (settings as any).sttPrompt as string | undefined;
    const prompt = customPrompt && customPrompt.trim()
      ? customPrompt.trim()
      : (promptLang && DEFAULT_PROMPTS[promptLang]) || '';
    if (prompt) form.append('prompt', prompt);
    return form;
  };

  // Retry transient rate-limits (429) and 5xx with exponential back-off,
  // honouring Groq's "try again in Xs" hint when present. A 429 is usually
  // the per-MINUTE limit, which a short wait clears — this turns what used
  // to be a hard "transcription failed" error into a brief, invisible pause.
  // Non-retryable 4xx (bad key, bad audio) still throw immediately. NOTE: a
  // per-DAY quota exhaustion also returns 429 but won't clear in seconds —
  // retries will be exhausted and it throws, as before (see OpenAI/local STT).
  const backoff = [1000, 2000, 4000];
  for (let attempt = 0; attempt <= backoff.length; attempt++) {
    const res = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.groqApiKey}` },
      body: buildForm() as any,
    });

    if (res.ok) {
      const data = (await res.json()) as { text: string; language?: string };
      return { text: (data.text || '').trim(), language: data.language };
    }

    const body = await res.text().catch(() => '');
    const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
    if (!retryable || attempt === backoff.length) {
      throw new Error(`Groq ${res.status} ${res.statusText} — ${body.slice(0, 300)}`);
    }

    let wait = backoff[attempt];
    const hint = body.match(/try again in ([0-9.]+)s/i);
    if (hint) wait = Math.max(wait, Math.ceil(parseFloat(hint[1]) * 1000));
    console.warn(`[whisper] Groq ${res.status} — retry ${attempt + 1}/${backoff.length} in ${wait}ms`);
    await new Promise((r) => setTimeout(r, wait));
  }
  // Unreachable (the loop either returns or throws), but satisfies the type checker.
  throw new Error('Groq transcription failed after retries');
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
