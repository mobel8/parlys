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

/** One word of a verbose_json response with timestamp_granularities=word. */
interface VerboseWord {
  word?: string;
  start?: number;
  end?: number;
}

/**
 * Client-side speech geometry forwarded from the renderer's speech gate.
 * Times in ms, same timeline as the shipped clip / Whisper timestamps.
 * See src/shared/speech-gate.ts::speechMetaFor.
 */
export interface ClientSpeechMeta {
  intervalsMs: Array<[number, number]>;
  endMs: number;
  startMs: number;
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
 *   - no_speech_prob > 0.5 AND avg_logprob < -0.85 → the COMBO zone where
 *     noise-fed hallucinations live: each signal alone is too weak to act
 *     on, but "probably not speech" + "not confident in the tokens"
 *     together is (per the whisper-timestamped / WhisperX literature) a
 *     reliable hallucination signature. Real faint speech with a correct
 *     forced language decodes with logprob ≳ -0.6.
 *
 * A segment is filtered if AT LEAST ONE rule fires. We count the filter
 * as fail-open: if the field is missing (older API version, Groq decided
 * to omit it) we keep the segment.
 */
const NO_SPEECH_PROB_MAX = 0.7;
const AVG_LOGPROB_MIN = -1.2;
const COMPRESSION_RATIO_MAX = 2.6;
const COMBO_NO_SPEECH_MIN = 0.5;
const COMBO_LOGPROB_MAX = -0.85;

function isLowConfidence(seg: VerboseSegment): boolean {
  if (typeof seg.no_speech_prob === 'number' && seg.no_speech_prob > NO_SPEECH_PROB_MAX) return true;
  if (typeof seg.avg_logprob === 'number' && seg.avg_logprob < AVG_LOGPROB_MIN) return true;
  if (typeof seg.compression_ratio === 'number' && seg.compression_ratio > COMPRESSION_RATIO_MAX) return true;
  if (
    typeof seg.no_speech_prob === 'number' && typeof seg.avg_logprob === 'number' &&
    seg.no_speech_prob > COMBO_NO_SPEECH_MIN && seg.avg_logprob < COMBO_LOGPROB_MAX
  ) return true;
  return false;
}

/**
 * Cross-check thresholds between Whisper timestamps and the CLIENT-side
 * speech geometry (speech-gate). Whisper's segment/word timestamps are
 * accurate to roughly ±0.3 s on clean speech, so every rule carries a
 * generous slop — a real word must never die to a timestamp jitter.
 *
 *   - INTERVAL_SLOP_MS   expands every client speech interval both ways
 *     before the overlap test; a segment overlapping NO expanded interval
 *     sits entirely inside client-measured silence → hallucination.
 *   - TAIL_SEG_SLOP_MS   a segment STARTING this far after the client's
 *     last speech instant is invented (the shipped clip physically ends
 *     ~320 ms after that instant).
 *   - WORD_TAIL_SLOP_MS  same idea per WORD — the surgical rule that kills
 *     "…ma vraie phrase. et n'oubliez pas de liker" tails where Whisper
 *     appends inventions to an otherwise-valid segment.
 */
const INTERVAL_SLOP_MS = 450;
const TAIL_SEG_SLOP_MS = 500;
const WORD_TAIL_SLOP_MS = 350;

function overlapsClientSpeech(
  segStartMs: number,
  segEndMs: number,
  intervals: Array<[number, number]>,
): boolean {
  for (const [s, e] of intervals) {
    if (segStartMs < e + INTERVAL_SLOP_MS && segEndMs > s - INTERVAL_SLOP_MS) return true;
  }
  return false;
}

export interface TranscribeOptions {
  /** External cancellation / per-call deadline. */
  signal?: AbortSignal;
  /**
   * Client speech geometry — enables the timestamp cross-check rules in
   * applySegmentFilter (dictation pipeline only; interpreter/listener
   * don't send it and keep the historical behaviour).
   */
  speechMeta?: ClientSpeechMeta;
  /**
   * Cap on 429/5xx retries. Speculative calls pass 0: burning the rate
   * limit on a call the user may never commit is wrong — if it fails, the
   * classic path at stop-time retries as usual.
   */
  maxRetries?: number;
}

export async function transcribeWithGroq(
  audio: Buffer,
  mimeType: string,
  settings: Settings,
  signal?: AbortSignal,
  opts?: Omit<TranscribeOptions, 'signal'>,
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
    // Word-level timestamps power the tail-word hallucination cut (drop
    // words that "start" after the client measured end-of-speech). Groq
    // returns BOTH words and segments when both granularities are asked
    // (verified live 2026-07-10); the payload grows by a few hundred bytes.
    form.append('timestamp_granularities[]', 'word');
    form.append('timestamp_granularities[]', 'segment');
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
  const backoffAll = [350, 1200, 3000];
  const backoff = typeof opts?.maxRetries === 'number'
    ? backoffAll.slice(0, Math.max(0, opts.maxRetries))
    : backoffAll;
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
        words?: VerboseWord[];
      };
      const cleanText = applySegmentFilter(data, opts?.speechMeta);
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
 * (`isLowConfidence`) — and, when the CLIENT speech geometry is
 * available (`meta`), dropping segments/words whose timestamps land
 * where the client measured silence.
 *
 * Falls back to the response's `text` field ONLY when segments are
 * absent (older API versions / stripped responses).
 *
 * When segments ARE present and EVERY one of them is dropped, the
 * answer is the empty string — FAIL-CLOSED. This used to fall back
 * to the full text "for the regex scrubber", which is exactly how a
 * silence-only clip became a pasted "Merci." : the model itself said
 * no_speech on every segment, but the hallucinated token wasn't in the
 * regex bank (bare "merci" can't be — it's legitimate dictation), so
 * the fail-open path shipped it to the user's cursor. When the model
 * flags everything it produced as silence/noise, believe it.
 *
 * TIMESTAMP CROSS-CHECK (meta present — dictation pipeline only):
 *   1. SEGMENT rule — a segment overlapping NO client speech interval
 *      (each expanded ±INTERVAL_SLOP_MS) sits entirely inside measured
 *      silence: dropped. Catches inventions during mid-dictation pauses.
 *   2. TAIL-SEGMENT rule — a segment STARTING > endMs+TAIL_SEG_SLOP_MS is
 *      beyond the physical end of shipped audio (the clip stops ~320 ms
 *      after the last word): dropped.
 *   3. TAIL-WORD rule — the surgical one. Whisper often APPENDS invented
 *      words to the final, otherwise-valid segment ("…ma phrase. Merci.").
 *      Word-level timestamps expose them: every trailing word whose start
 *      is > endMs+WORD_TAIL_SLOP_MS gets cut from the final text. Guarded:
 *      never cuts more than MAX_TAIL_WORDS_CUT or >60% of the tokens (a
 *      global timestamp drift must not shred a real dictation).
 *
 * Exported for the unit-test harness (scripts/test-hallucination-filter.js).
 */
const MAX_TAIL_WORDS_CUT = 12;

export function applySegmentFilter(
  data: {
    text?: string;
    segments?: VerboseSegment[];
    words?: VerboseWord[];
  },
  meta?: ClientSpeechMeta,
): string {
  const fallback = (data.text || '').trim();
  if (!Array.isArray(data.segments) || data.segments.length === 0) {
    return fallback;
  }
  const hasMeta = !!(meta && Array.isArray(meta.intervalsMs) && meta.intervalsMs.length > 0
    && typeof meta.endMs === 'number' && meta.endMs > 0);
  const kept: VerboseSegment[] = [];
  let droppedCount = 0;
  const drop = (seg: VerboseSegment, why: string) => {
    droppedCount += 1;
    console.log(
      `[whisper] dropped segment (${why}) ` +
      `t=[${seg.start?.toFixed(2) ?? '?'}-${seg.end?.toFixed(2) ?? '?'}s] ` +
      `no_speech=${seg.no_speech_prob?.toFixed(3) ?? '?'} ` +
      `logprob=${seg.avg_logprob?.toFixed(3) ?? '?'} ` +
      `cr=${seg.compression_ratio?.toFixed(2) ?? '?'} ` +
      `→ "${(seg.text || '').slice(0, 60).trim()}"`,
    );
  };
  for (const seg of data.segments) {
    if (!seg || typeof seg.text !== 'string') continue;
    if (isLowConfidence(seg)) { drop(seg, 'low-confidence'); continue; }
    if (hasMeta && typeof seg.start === 'number') {
      const segStartMs = seg.start * 1000;
      const segEndMs = typeof seg.end === 'number' ? seg.end * 1000 : segStartMs;
      if (segStartMs > meta!.endMs + TAIL_SEG_SLOP_MS) { drop(seg, 'starts-after-speech-end'); continue; }
      if (!overlapsClientSpeech(segStartMs, segEndMs, meta!.intervalsMs)) {
        drop(seg, 'inside-client-silence'); continue;
      }
    }
    kept.push(seg);
  }
  if (kept.length === 0) {
    if (droppedCount > 0) {
      console.warn(
        `[whisper] every segment (${droppedCount}) was dropped → returning EMPTY ` +
        `(discarded: "${fallback.slice(0, 60)}")`,
      );
      return '';
    }
    // No segment carried usable text at all (all missing/typeless) —
    // treat like a segment-less response.
    return fallback;
  }
  // Joining then collapsing whitespace matches Whisper's own segment concat.
  let text = kept.map((s) => s.text as string).join('').replace(/\s+/g, ' ').trim();

  // TAIL-WORD rule — only with client geometry AND word timestamps.
  if (hasMeta && Array.isArray(data.words) && data.words.length > 0 && text) {
    text = cutTailWords(text, kept, data.words, meta!);
  }
  return text;
}

/**
 * Cut trailing words whose word-level timestamp starts after the client
 * measured end-of-speech (+slop). Operates on whitespace tokens of the
 * KEPT text; only words belonging to kept segments are considered (words
 * of dropped segments are already gone from the text).
 */
function cutTailWords(
  text: string,
  keptSegments: VerboseSegment[],
  words: VerboseWord[],
  meta: ClientSpeechMeta,
): string {
  const cutoffMs = meta.endMs + WORD_TAIL_SLOP_MS;
  // Words inside any kept segment's span (±200 ms tolerance on both ends —
  // Groq word/segment boundaries disagree by a few 10s of ms routinely).
  const spans = keptSegments
    .filter((s) => typeof s.start === 'number')
    .map((s) => [
      (s.start as number) * 1000 - 200,
      (typeof s.end === 'number' ? s.end : (s.start as number)) * 1000 + 200,
    ] as [number, number]);
  const inKept = (w: VerboseWord) => {
    if (typeof w.start !== 'number') return false;
    const ms = w.start * 1000;
    return spans.some(([a, b]) => ms >= a && ms <= b);
  };
  const keptWords = words.filter(inKept);
  if (keptWords.length === 0) return text;

  let trailing = 0;
  for (let i = keptWords.length - 1; i >= 0; i--) {
    const w = keptWords[i];
    if (typeof w.start === 'number' && w.start * 1000 > cutoffMs) trailing++;
    else break;
  }
  if (trailing === 0) return text;

  const tokens = text.split(/\s+/).filter(Boolean);
  // Safety bounds: a GLOBAL timestamp drift (rare, odd audio) must never
  // shred a real dictation. Cutting HALF the tokens or more means Whisper's
  // timeline and the client's fundamentally disagree — distrust the cut,
  // keep the text, let the segment rules / regex scrubber deal with it.
  if (trailing >= tokens.length || trailing > MAX_TAIL_WORDS_CUT || trailing * 2 >= tokens.length) {
    console.warn(
      `[whisper] tailcut SKIPPED (guard): ${trailing} trailing word(s) beyond ` +
      `speechEnd+${WORD_TAIL_SLOP_MS}ms of ${tokens.length} tokens`,
    );
    return text;
  }
  const cut = tokens.slice(tokens.length - trailing).join(' ');
  const keptText = tokens.slice(0, tokens.length - trailing).join(' ')
    .replace(/[\s,;:]+$/, '');
  console.log(
    `[whisper] tailcut dropped ${trailing} trailing word(s) starting after ` +
    `speechEnd+${WORD_TAIL_SLOP_MS}ms (client endMs=${meta.endMs}) → cut "${cut.slice(0, 60)}"`,
  );
  return keptText;
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
