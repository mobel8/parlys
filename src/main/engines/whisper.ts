// Groq Whisper transcription engine.
// Uses the OpenAI-compatible audio/transcriptions endpoint hosted by Groq.
// Whisper-large-v3-turbo is near real-time (~200-400ms for a few seconds of audio).

import { Settings } from '../../shared/types';

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';

/**
 * Default vocabulary-biasing prompts per language.
 *
 * IMPORTANT — we deliberately do NOT pack a wordlist here.
 *
 * Earlier versions of this file shipped a comma-separated technical
 * glossary ("Parlys, API, MCP, LLM, GPT, Claude, Anthropic, Groq…").
 * That was actively harmful: on trailing silence Whisper falls back on
 * the prompt's distribution to "continue" the utterance, and when the
 * distribution is a wordlist the model emits stuff like "Parlys API
 * MCP Groq" out of thin air. We saw this hallucination in production
 * on short clips with ~500 ms of post-speech silence.
 *
 * The fix is to keep the prompt as ONE natural sentence that demonstrates
 * style (punctuation, capitalisation, accents) without giving the model
 * a vocabulary list to draw from. Users who want brand-name biasing can
 * still set `settings.sttPrompt` — and they should write it as a
 * sentence, not a wordlist, for the same reason.
 *
 * Prompt MUST be in the same language as the audio, otherwise Whisper
 * code-switches to the prompt's language.
 */
const DEFAULT_PROMPTS: Record<string, string> = {
  fr: "Voici une dictée en français avec ponctuation, majuscules et accents corrects.",
  en: "Here is dictation in English with correct punctuation and capitalisation.",
  es: "Esta es una dictación en español con puntuación y mayúsculas correctas.",
  de: "Hier ist ein Diktat auf Deutsch mit korrekter Zeichensetzung und Großschreibung.",
  it: "Questa è una dettatura in italiano con punteggiatura e maiuscole corrette.",
  pt: "Esta é uma ditado em português com pontuação e maiúsculas corretas.",
};

export interface WhisperResult {
  text: string;
  language?: string;
}

/**
 * One segment of a Groq verbose_json response. Mirrors the OpenAI
 * /audio/transcriptions schema — fields can be missing if the model
 * didn't compute them, in which case we conservatively keep the
 * segment.
 */
interface VerboseSegment {
  id?: number;
  start?: number;
  end?: number;
  text?: string;
  /** Higher = model more confident this is silence/noise, not speech. */
  no_speech_prob?: number;
  /** Lower (more negative) = less confident in the decoded tokens. */
  avg_logprob?: number;
  /** Higher = more repetitive output (Whisper's classic loop hallucination). */
  compression_ratio?: number;
}

/**
 * Confidence thresholds for the verbose_json hallucination filter.
 *
 * Values come from the OpenAI Whisper paper §4 ("Robustness via
 * decoding heuristics") but slightly loosened so we keep faint but
 * real speech instead of clipping it. False-negative on a real word
 * is much worse for a dictation app than a stray "Merci d'avoir
 * regardé" that gets handed off to the regex scrubber downstream.
 *
 *   - no_speech_prob > 0.7    → segment is probably pure silence/noise
 *   - avg_logprob    < -1.2   → model very uncertain about the tokens
 *   - compression_ratio > 2.6 → text is repeating itself (looped)
 *
 * A segment is filtered if AT LEAST ONE threshold is breached. We
 * count the filter as fail-open: if the field is missing (older API
 * version, Groq decided to omit it) we keep the segment.
 */
const NO_SPEECH_PROB_MAX = 0.7;
const AVG_LOGPROB_MIN = -1.2;
const COMPRESSION_RATIO_MAX = 2.6;

function isLowConfidence(seg: VerboseSegment): boolean {
  if (typeof seg.no_speech_prob === 'number' && seg.no_speech_prob > NO_SPEECH_PROB_MAX) return true;
  if (typeof seg.avg_logprob === 'number' && seg.avg_logprob < AVG_LOGPROB_MIN) return true;
  if (typeof seg.compression_ratio === 'number' && seg.compression_ratio > COMPRESSION_RATIO_MAX) return true;
  return false;
}

export async function transcribeWithGroq(
  audio: Buffer,
  mimeType: string,
  settings: Settings,
  signal?: AbortSignal,
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
    // verbose_json gives us per-segment no_speech_prob / avg_logprob /
    // compression_ratio — the three signals we use to drop hallucinated
    // segments. Cost is negligible (~5% bigger response payload).
    form.append('response_format', 'verbose_json');
    // temperature=0 = pure greedy decoding, no sampling fallback. This is
    // the SAFER setting against hallucinations; the OpenAI default of
    // temperature-fallback can decode louder hallucinations on a silent
    // input because it re-samples until logprob comes up.
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
  // First retry at 350 ms (not 1 s) so a transient single-minute 429 blip
  // clears near-invisibly on the interactive dictation path. A genuine
  // sustained rate-limit that supplies a "try again in Xs" hint is still
  // honoured via Math.max below.
  const backoff = [350, 1200, 3000];
  for (let attempt = 0; attempt <= backoff.length; attempt++) {
    const res = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.groqApiKey}`,
        // Keep the TLS socket pooled so the next call (translate, LLM,
        // a second dictation in quick succession) reuses it. Saves the
        // 40-100 ms TCP+TLS handshake on every cold call.
        Connection: 'keep-alive',
      },
      body: buildForm() as any,
      // Per-call deadline / external cancellation. undefined → no signal,
      // i.e. byte-for-byte the historical behaviour. An aborted fetch
      // rejects (AbortError/TimeoutError) and propagates to the caller.
      signal,
    });

    if (res.ok) {
      const data = (await res.json()) as {
        text?: string;
        language?: string;
        segments?: VerboseSegment[];
      };
      const cleanText = applySegmentFilter(data);
      // Normalise Whisper's language to an ISO-639-1 code at the source.
      // Groq returns the full name ("french", "english"), which then leaked
      // into history badges ("FRENCH"), CSV/MD exports, and byLanguage stats.
      // Storing the code keeps every downstream consumer consistent.
      return { text: cleanText, language: normalizeLangToISO(data.language) };
    }

    const body = await res.text().catch(() => '');
    // If the request was aborted (per-call timeout fired, or a newer utterance
    // superseded this one), stop retrying and surface the abort immediately —
    // retrying an aborted request would just burn the whole deadline again.
    if (signal?.aborted) {
      throw (signal as any).reason ?? new Error('aborted');
    }
    const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
    if (!retryable || attempt === backoff.length) {
      // Map known statuses to actionable French messages. The raw provider
      // body stays in the console for diagnostics, but the user sees
      // something they can act on instead of "Groq 429 Too Many R…".
      console.error(`[whisper] Groq ${res.status} ${res.statusText} — ${body.slice(0, 300)}`);
      throw new Error(friendlyGroqError(res.status, res.statusText));
    }

    let wait = backoff[attempt];
    const hint = body.match(/try again in ([0-9.]+)s/i);
    if (hint) wait = Math.max(wait, Math.ceil(parseFloat(hint[1]) * 1000));
    console.warn(`[whisper] Groq ${res.status} — retry ${attempt + 1}/${backoff.length} in ${wait}ms`);
    // Abortable back-off: a supersede/timeout during the sleep rejects
    // immediately instead of burning the remaining wait before the next
    // fetch observes the aborted signal.
    await new Promise<void>((resolve, reject) => {
      // Aborted in the tiny window since the check above? Reject now — an
      // 'abort' listener attached to an already-fired signal never runs, which
      // would otherwise burn the full back-off before the next fetch sees it.
      if (signal?.aborted) { reject((signal as any).reason ?? new Error('aborted')); return; }
      const t = setTimeout(resolve, wait);
      signal?.addEventListener('abort', () => {
        clearTimeout(t);
        reject((signal as any).reason ?? new Error('aborted'));
      }, { once: true });
    });
  }
  // Unreachable (the loop either returns or throws), but satisfies the type checker.
  throw new Error('Groq transcription failed after retries');
}

/** Map a Groq/Whisper status to an actionable French error message. */
function friendlyGroqError(status: number, statusText: string): string {
  if (status === 401 || status === 403) {
    return 'Clé API Groq invalide ou révoquée. Vérifiez-la dans Paramètres.';
  }
  if (status === 429) {
    return 'Limite de requêtes Groq atteinte (quota). Réessayez plus tard ou utilisez une autre clé.';
  }
  if (status === 413) {
    return 'Audio trop long pour Groq. Dictez des segments plus courts.';
  }
  if (status >= 500) {
    return 'Service Groq temporairement indisponible. Réessayez dans un instant.';
  }
  return `Erreur Groq (${status} ${statusText}). Réessayez ou vérifiez votre clé dans Paramètres.`;
}

/**
 * Whisper/Groq returns the full English language NAME ("french"). Map it to
 * an ISO-639-1 code so badges/exports/stats stay short and consistent. Pass
 * through anything already short (≤3 chars = already a code) or unknown.
 */
const LANG_NAME_TO_ISO: Record<string, string> = {
  french: 'fr', english: 'en', spanish: 'es', german: 'de', italian: 'it',
  portuguese: 'pt', dutch: 'nl', polish: 'pl', russian: 'ru', japanese: 'ja',
  chinese: 'zh', korean: 'ko', arabic: 'ar', turkish: 'tr', hindi: 'hi',
  swedish: 'sv', norwegian: 'no', danish: 'da', finnish: 'fi', greek: 'el',
  czech: 'cs', romanian: 'ro', hungarian: 'hu', ukrainian: 'uk', catalan: 'ca',
};
function normalizeLangToISO(lang?: string): string | undefined {
  if (!lang) return lang;
  const l = lang.trim().toLowerCase();
  if (l.length <= 3) return l; // already an ISO code
  return LANG_NAME_TO_ISO[l] || l;
}

/**
 * Build the final text from a verbose_json response, dropping any
 * segment whose confidence signals flag it as a hallucination
 * (`isLowConfidence`).
 *
 * Falls back to the response's `text` field ONLY when segments are
 * absent (older API versions / stripped responses).
 *
 * When segments ARE present and EVERY one of them is low-confidence,
 * the answer is the empty string — FAIL-CLOSED. This used to fall back
 * to the full text "for the regex scrubber", which is exactly how a
 * silence-only clip became a pasted "Merci." : the model itself said
 * no_speech on every segment, but the hallucinated token wasn't in the
 * regex bank (bare "merci" can't be — it's legitimate dictation), so
 * the fail-open path shipped it to the user's cursor. When the model
 * flags everything it produced as silence/noise, believe it.
 *
 * Exported for the unit-test harness (scripts/test-hallucination-filter.js).
 */
export function applySegmentFilter(data: {
  text?: string;
  segments?: VerboseSegment[];
}): string {
  const fallback = (data.text || '').trim();
  if (!Array.isArray(data.segments) || data.segments.length === 0) {
    return fallback;
  }
  const kept: string[] = [];
  let droppedCount = 0;
  for (const seg of data.segments) {
    if (!seg || typeof seg.text !== 'string') continue;
    if (isLowConfidence(seg)) {
      droppedCount += 1;
      console.log(
        `[whisper] dropped low-confidence segment ` +
        `no_speech=${seg.no_speech_prob?.toFixed(3) ?? '?'} ` +
        `logprob=${seg.avg_logprob?.toFixed(3) ?? '?'} ` +
        `cr=${seg.compression_ratio?.toFixed(2) ?? '?'} ` +
        `→ "${seg.text.slice(0, 60).trim()}"`,
      );
      continue;
    }
    kept.push(seg.text);
  }
  if (kept.length === 0) {
    if (droppedCount > 0) {
      console.warn(
        `[whisper] every segment (${droppedCount}) was low-confidence → returning EMPTY ` +
        `(discarded: "${fallback.slice(0, 60)}")`,
      );
      return '';
    }
    // No segment carried usable text at all (all missing/typeless) —
    // treat like a segment-less response.
    return fallback;
  }
  // Joining with a single space matches Whisper's own segment concat.
  return kept.join('').replace(/\s+/g, ' ').trim();
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
