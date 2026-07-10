/**
 * Tiny runtime validators for the IPC boundary.
 *
 * The renderer is already trusted (contextIsolation + sandbox + strict CSP)
 * but these guards are a defense-in-depth layer: if the renderer is ever
 * compromised (e.g. via a supply-chain vulnerability), these prevent the
 * most obvious abuses — oversized strings that OOM the main process,
 * malformed identifiers used to read/delete arbitrary history entries,
 * accidental injection of unexpected settings fields etc.
 *
 * Kept intentionally minimal: we sanitize the few values that actually
 * matter for safety or persistence, and drop everything else. We do NOT
 * try to exhaustively validate every Settings field — that's what the
 * TypeScript types (and electron-store's merge) are for.
 */

import { Settings, TranscribeRequest, TranscribeCommitRequest, InterpretRequest } from '../../shared/types';

/** Upper bound on how big an audio payload we accept in a single IPC call. */
const MAX_AUDIO_BASE64_LEN = 32 * 1024 * 1024; // ~24 MB decoded, enough for long dictations
/** Upper bound on an arbitrary text payload (e.g. clipboard text). */
const MAX_TEXT_LEN = 256 * 1024; // 256 kB
/** Upper bound on API keys / free-form settings strings. */
const MAX_KEY_LEN = 2048;
/**
 * Upper bound on how many custom replacement rules we persist. Each rule is
 * compiled to a fresh RegExp and run sequentially over EVERY transcription,
 * so an unbounded list is a CPU-amplification vector. 500 is far above any
 * realistic dictionary while keeping the per-transcription cost negligible.
 */
const MAX_REPLACEMENTS = 500;
/** Upper bound on a replacement trigger (`from`). Mirrors short-id limits. */
const MAX_REPLACEMENT_FROM_LEN = 256;
/** Upper bound on a replacement output (`to`). Same cap as sttModel/sttPrompt. */
const MAX_REPLACEMENT_TO_LEN = 4096;
/** Upper bound on the JSON serialization of a structured sub-object. */
const MAX_STRUCT_JSON_BYTES = 4096;

/**
 * Reject an object whose JSON serialization is implausibly large. Used as a
 * cheap belt-and-braces guard on structured fields whose individual sub-keys
 * we also clamp below: stops a forged renderer from bloating the store with a
 * giant object full of unexpected keys.
 */
function jsonByteLength(x: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(x) ?? '', 'utf8');
  } catch {
    // Circular / non-serializable → treat as oversized so the caller rejects.
    return Number.POSITIVE_INFINITY;
  }
}

export function isString(x: unknown): x is string {
  return typeof x === 'string';
}
export function isBoolean(x: unknown): x is boolean {
  return typeof x === 'boolean';
}
export function isNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}
export function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Narrow a string to a finite set of literals. */
export function isOneOf<T extends string>(x: unknown, allowed: readonly T[]): x is T {
  return typeof x === 'string' && (allowed as readonly string[]).includes(x);
}

/** Truncate a string to an upper bound. Returns undefined if not a string. */
export function clampString(x: unknown, max: number): string | undefined {
  return isString(x) ? x.slice(0, max) : undefined;
}

/**
 * Validate a history-entry ID. We generate UUIDs via `crypto.randomUUID`
 * but accept any reasonably short printable string to avoid false rejects
 * for legacy entries. Path-separator characters are forbidden to stop any
 * attempt to reuse the id as a filesystem path.
 */
export function validateHistoryId(x: unknown): string | null {
  if (!isString(x)) return null;
  const s = x.trim();
  if (s.length === 0 || s.length > 128) return null;
  if (/[\\/\0\r\n]/.test(s)) return null;
  return s;
}

/** Validate an export format. */
export function validateExportFormat(x: unknown): 'json' | 'markdown' | 'txt' | 'csv' | null {
  return isOneOf(x, ['json', 'markdown', 'txt', 'csv'] as const) ? x : null;
}

/** Validate a transcribe request coming from the renderer. */
export function validateTranscribeRequest(x: unknown): TranscribeRequest | null {
  if (!isObject(x)) return null;
  const audioBase64 = x.audioBase64;
  if (!isString(audioBase64) || audioBase64.length === 0) return null;
  if (audioBase64.length > MAX_AUDIO_BASE64_LEN) return null;
  // Rough sanity check: base64 alphabet only.
  if (!/^[A-Za-z0-9+/=\s]+$/.test(audioBase64)) return null;
  const mimeType = isString(x.mimeType) ? x.mimeType.slice(0, 64) : 'audio/webm';
  const mode = isOneOf(
    x.mode,
    ['raw', 'natural', 'formal', 'message'] as const,
  )
    ? (x.mode as TranscribeRequest['mode'])
    : 'raw';
  const language = clampString(x.language, 16);
  const translateTo = clampString(x.translateTo, 16);
  // Optional client-side audio stats (diagnostics + history). Clamped to a
  // plausible dictation range; anything malformed is simply dropped.
  const clampMs = (v: unknown): number | undefined =>
    isNumber(v) ? Math.max(0, Math.min(600_000, Math.round(v))) : undefined;
  const audioMs = clampMs(x.audioMs);
  const speechMs = clampMs(x.speechMs);
  // Optional client speech geometry (speech-gate) — bounded list of
  // [startMs, endMs) pairs plus first/last speech instant. Malformed →
  // dropped entirely (the server filter then skips its timestamp rules,
  // never rejects the transcription).
  let speech: TranscribeRequest['speech'];
  if (isObject(x.speech)) {
    const sp = x.speech as Record<string, unknown>;
    const endMs = clampMs(sp.endMs);
    const startMs = clampMs(sp.startMs);
    if (endMs !== undefined && startMs !== undefined && Array.isArray(sp.intervalsMs)
      && sp.intervalsMs.length <= 400) {
      const intervalsMs: Array<[number, number]> = [];
      for (const iv of sp.intervalsMs) {
        if (!Array.isArray(iv) || iv.length !== 2) { intervalsMs.length = 0; break; }
        const a = clampMs(iv[0]);
        const b = clampMs(iv[1]);
        if (a === undefined || b === undefined || b <= a) { intervalsMs.length = 0; break; }
        intervalsMs.push([a, b]);
      }
      if (intervalsMs.length > 0) speech = { intervalsMs, endMs, startMs };
    }
  }
  // Speculative correlation id: short printable token, no path separators.
  const speculative = x.speculative === true;
  let specId: string | undefined;
  if (isString(x.specId)) {
    const s = x.specId.trim();
    if (s.length > 0 && s.length <= 96 && !/[\\/\0\r\n]/.test(s)) specId = s;
  }
  if (speculative && !specId) return null; // speculative REQUIRES a valid id
  return {
    audioBase64, mimeType, mode, language, translateTo, audioMs, speechMs,
    speech, speculative: speculative || undefined, specId,
  };
}

/** Validate a speculative-commit request coming from the renderer. */
export function validateTranscribeCommitRequest(x: unknown): TranscribeCommitRequest | null {
  if (!isObject(x)) return null;
  if (!isString(x.specId)) return null;
  const s = x.specId.trim();
  if (s.length === 0 || s.length > 96 || /[\\/\0\r\n]/.test(s)) return null;
  return { specId: s };
}

/** Validate an interpreter request coming from the renderer. */
export function validateInterpretRequest(x: unknown): InterpretRequest | null {
  if (!isObject(x)) return null;
  const audioBase64 = x.audioBase64;
  if (!isString(audioBase64) || audioBase64.length === 0) return null;
  if (audioBase64.length > MAX_AUDIO_BASE64_LEN) return null;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(audioBase64)) return null;
  const mimeType = isString(x.mimeType) ? x.mimeType.slice(0, 64) : 'audio/webm';
  const requestId = clampString(x.requestId, 64) || '';
  if (!requestId) return null;
  const targetLang = clampString(x.targetLang, 16) || '';
  if (!targetLang) return null;
  const sourceLang = clampString(x.sourceLang, 16);
  return { requestId, audioBase64, mimeType, sourceLang, targetLang };
}

/** Clamp an arbitrary text string (clipboard / injection). */
export function validateText(x: unknown): string | null {
  if (!isString(x)) return null;
  return x.slice(0, MAX_TEXT_LEN);
}

/**
 * Validate the input to IPC.SPEAK. Without this guard the handler used to
 * accept a raw `as { text }` cast — an unbounded string could OOM the main
 * process and a non-string `language` could land in a regex elsewhere.
 */
export function validateSpeakRequest(x: unknown): {
  requestId: string; text: string; language?: string;
} | null {
  if (!isObject(x)) return null;
  const requestId = clampString(x.requestId, 64);
  if (!requestId || !requestId.trim()) return null;
  const text = clampString(x.text, MAX_TEXT_LEN);
  if (!text || !text.trim()) return null;
  const language = clampString(x.language, 16);
  return { requestId, text, language };
}

/**
 * Validate the input to IPC.LISTENER_TRANSCRIBE. Mirrors
 * validateTranscribeRequest: bounds the base64 payload, restricts the
 * mime type to a short prefix, clamps language codes.
 */
export function validateListenerTranscribeRequest(x: unknown): {
  audioBase64: string; mimeType: string; targetLang: string; sourceLang?: string;
} | null {
  if (!isObject(x)) return null;
  const audioBase64 = x.audioBase64;
  if (!isString(audioBase64) || audioBase64.length === 0) return null;
  if (audioBase64.length > MAX_AUDIO_BASE64_LEN) return null;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(audioBase64)) return null;
  const mimeType = isString(x.mimeType) ? x.mimeType.slice(0, 64) : 'audio/webm';
  const targetLang = clampString(x.targetLang, 16) || '';
  const sourceLang = clampString(x.sourceLang, 16);
  return { audioBase64, mimeType, targetLang, sourceLang };
}

/**
 * Validate a history entry pushed via IPC.ADD_HISTORY. The previous
 * handler accepted `unknown` directly — a malformed renderer could write
 * arbitrary fields into the persisted JSON, including paths or oversized
 * strings. We pin the shape down here.
 */
export function validateHistoryEntry(x: unknown): null | {
  id: string; createdAt: number; rawText: string; finalText: string;
  mode: string; language: string; translatedTo?: string;
  durationMs: number; audioMs: number; tags: string[]; wordCount?: number;
  pinned?: boolean;
} {
  if (!isObject(x)) return null;
  const id = validateHistoryId(x.id);
  if (!id) return null;
  const createdAt = isNumber(x.createdAt) ? x.createdAt : Date.now();
  const rawText = clampString(x.rawText, MAX_TEXT_LEN) || '';
  const finalText = clampString(x.finalText, MAX_TEXT_LEN) || '';
  const mode = clampString(x.mode, 16) || 'raw';
  const language = clampString(x.language, 16) || 'auto';
  const translatedTo = clampString(x.translatedTo, 16);
  const durationMs = isNumber(x.durationMs) ? Math.max(0, x.durationMs) : 0;
  const audioMs = isNumber(x.audioMs) ? Math.max(0, x.audioMs) : 0;
  const tags = Array.isArray(x.tags)
    ? x.tags.filter((t) => isString(t) && (t as string).length <= 64).slice(0, 32) as string[]
    : [];
  const wordCount = isNumber(x.wordCount) ? Math.max(0, x.wordCount) : undefined;
  const pinned = isBoolean(x.pinned) ? x.pinned : undefined;
  return { id, createdAt, rawText, finalText, mode, language, translatedTo,
           durationMs, audioMs, tags, wordCount, pinned };
}

/**
 * Strip control characters that could be interpreted by a terminal or
 * messaging app as commands when injected via Ctrl+V. We keep \t, \n, \r
 * (legitimate whitespace) but drop bell, escape, RTL/LTR override marks,
 * and other invisible control bytes that have been used in past supply-
 * chain attacks (Trojan Source). Applied right before clipboard.writeText.
 */
export function sanitizeInjectionText(s: string): string {
  return s
    // C0 control chars except tab/LF/CR
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Bidirectional override chars (Trojan Source attacks)
    .replace(/[‪-‮⁦-⁩]/g, '');
}

/**
 * Sanitize an untrusted settings patch. We pick only known-safe primitive
 * fields and drop everything else. Large strings are truncated to protect
 * the store file from being blown up.
 */
export function sanitizeSettingsPatch(raw: unknown): Partial<Settings> {
  if (!isObject(raw)) return {};
  const p = raw as Record<string, unknown>;
  const out: Partial<Settings> = {};

  // Strings (API keys, model names, language codes, etc.)
  const stringFields: Array<[keyof Settings, number]> = [
    ['groqApiKey', MAX_KEY_LEN],
    ['sttModel', 256],
    ['llmProvider', 32],
    ['llmApiKey', MAX_KEY_LEN],
    ['llmModel', 256],
    ['mode', 16],
    ['language', 16],
    ['translateTo', 16],
    ['translateModel', 256],
    ['shortcutToggle', 128],
    ['shortcutPTT', 128],
    ['shortcutInterpreter', 128],
    ['uiLanguage', 8],
    ['themeId', 64],
    ['density', 16],
    ['interpretTargetLang', 16],
    ['ttsProvider', 32],
    ['ttsSinkId', 256],
    ['listenerInputDeviceId', 256],
    ['listenerTargetLang', 16],
    ['listenerMode', 16],
    ['sttPrompt', 4096],
    ['injectMode', 16],
  ];
  for (const [k, max] of stringFields) {
    const v = clampString(p[k as string], max);
    if (v !== undefined) (out as any)[k] = v;
  }

  // Booleans
  const boolFields: Array<keyof Settings> = [
    'llmEnabled',
    'autoCopy',
    'autoInject',
    'pttEnabled',
    'autoStart',
    'alwaysOnTop',
    'replacementsEnabled',
    'startMinimized',
    'soundsEnabled',
    'interpreterEnabled',
    'interpreterContinuous',
    'listenerEnabled',
    'speakTranslations',
    'vadCalibrated',
    'speculativeStt',
  ];
  for (const k of boolFields) {
    if (isBoolean(p[k as string])) (out as any)[k] = p[k as string];
  }

  // Numbers
  if (isNumber(p.ttsSpeed)) {
    out.ttsSpeed = Math.max(0.25, Math.min(4.0, p.ttsSpeed));
  }
  // VAD thresholds — must be in a sane RMS range (0..1).
  for (const k of ['vadNoiseFloor', 'vadSoftThreshold', 'vadHardThreshold', 'vadSilenceEnd'] as const) {
    if (isNumber(p[k])) (out as any)[k] = Math.max(0, Math.min(1, p[k] as number));
  }
  // Clamp pillScale to a safe range — a malformed value mustn't shrink
  // the BrowserWindow to 0 px or blow it up off-screen.
  if (isNumber(p.pillScale)) {
    out.pillScale = Math.max(0.5, Math.min(1.5, p.pillScale));
  }

  // Structured fields — re-validate every sub-field. These reach disk and,
  // for `replacements`, get compiled to RegExp + run over every transcription,
  // so a forged renderer must not be able to blow up the store or the CPU.
  //
  // `replacements`: cap the list length, keep only well-formed objects, clamp
  // `from`/`to`, coerce the boolean flags, and drop rules with a blank `from`
  // (a blank trigger matches everywhere / compiles to a degenerate RegExp).
  if (Array.isArray(p.replacements)) {
    const rules: Array<{
      id: string; from: string; to: string;
      caseSensitive: boolean; wholeWord: boolean; enabled: boolean;
    }> = [];
    for (const r of (p.replacements as unknown[]).slice(0, MAX_REPLACEMENTS)) {
      if (!isObject(r)) continue;
      const from = (clampString(r.from, MAX_REPLACEMENT_FROM_LEN) ?? '').trim();
      if (!from) continue; // drop blank/whitespace triggers
      const to = clampString(r.to, MAX_REPLACEMENT_TO_LEN) ?? '';
      const id = clampString(r.id, 128) || '';
      rules.push({
        id,
        from,
        to,
        caseSensitive: isBoolean(r.caseSensitive) ? r.caseSensitive : false,
        wholeWord: isBoolean(r.wholeWord) ? r.wholeWord : true,
        enabled: isBoolean(r.enabled) ? r.enabled : true,
      });
    }
    out.replacements = rules as any;
  }

  // `themeEffects`: pin the two known numeric sub-fields to their documented
  // ranges (glowIntensity 0..100, blurStrength 0..30) and coerce the four
  // boolean toggles. Unknown keys are dropped. Reject outright if the raw
  // object is implausibly large.
  if (isObject(p.themeEffects) && jsonByteLength(p.themeEffects) <= MAX_STRUCT_JSON_BYTES) {
    const e = p.themeEffects;
    const fx: Record<string, number | boolean> = {};
    if (isNumber(e.glowIntensity)) fx.glowIntensity = Math.max(0, Math.min(100, e.glowIntensity));
    if (isNumber(e.blurStrength)) fx.blurStrength = Math.max(0, Math.min(30, e.blurStrength));
    if (isBoolean(e.animateAura)) fx.animateAura = e.animateAura;
    if (isBoolean(e.auraEnabled)) fx.auraEnabled = e.auraEnabled;
    if (isBoolean(e.shimmer)) fx.shimmer = e.shimmer;
    if (isBoolean(e.grain)) fx.grain = e.grain;
    out.themeEffects = fx as any;
  }

  // `widgetBounds`: only `{ x, y }` finite pixel coordinates, or null to clear.
  // Clamp to a generous on-screen range so a forged value can't park the pill
  // millions of pixels off-screen where the user can never recover it.
  if (isObject(p.widgetBounds)) {
    const b = p.widgetBounds;
    if (isNumber(b.x) && isNumber(b.y)) {
      out.widgetBounds = {
        x: Math.max(-32768, Math.min(32768, b.x)),
        y: Math.max(-32768, Math.min(32768, b.y)),
      } as any;
    }
  } else if (p.widgetBounds === null) {
    out.widgetBounds = null;
  }

  // TTS voice ids and API keys — keyed by provider. Sanitize each entry.
  if (isObject(p.ttsVoiceId)) {
    const v: Partial<Record<string, string>> = {};
    for (const k of Object.keys(p.ttsVoiceId)) {
      if (k === 'cartesia' || k === 'elevenlabs' || k === 'openai') {
        const val = clampString((p.ttsVoiceId as any)[k], 128);
        if (val !== undefined) v[k] = val;
      }
    }
    out.ttsVoiceId = v as any;
  }
  if (isObject(p.ttsApiKey)) {
    const v: Partial<Record<string, string>> = {};
    for (const k of Object.keys(p.ttsApiKey)) {
      if (k === 'cartesia' || k === 'elevenlabs' || k === 'openai') {
        const val = clampString((p.ttsApiKey as any)[k], MAX_KEY_LEN);
        if (val !== undefined) v[k] = val;
      }
    }
    out.ttsApiKey = v as any;
  }

  // Enforce ttsProvider enum.
  if (out.ttsProvider && !['cartesia', 'elevenlabs', 'openai'].includes(out.ttsProvider)) {
    delete out.ttsProvider;
  }
  // Enforce listenerMode enum.
  if (out.listenerMode && out.listenerMode !== 'text' && out.listenerMode !== 'audio') {
    delete out.listenerMode;
  }
  // Enforce injectMode enum — only 'paste' and 'type' are valid. A
  // corrupted value would otherwise reach injection.ts and silently fall
  // back to paste (the safer default).
  if ((out as any).injectMode && (out as any).injectMode !== 'paste' && (out as any).injectMode !== 'type') {
    delete (out as any).injectMode;
  }

  // Enforce llmProvider enum — a forged / corrupted value would otherwise
  // fall through every postProcess branch and silently disable LLM polish.
  if (out.llmProvider && !['groq', 'openai', 'anthropic', 'ollama', 'cerebras'].includes(out.llmProvider)) {
    delete out.llmProvider;
  }

  // Enforce the density enum explicitly (several code paths branch on it).
  if (out.density && out.density !== 'compact' && out.density !== 'comfortable') {
    delete out.density;
  }

  // Enforce the uiLanguage enum — only ship FR/EN for now plus 'auto'.
  // Any other value (corrupted JSON, forged IPC) falls back to default.
  if (out.uiLanguage && out.uiLanguage !== 'auto' && out.uiLanguage !== 'fr' && out.uiLanguage !== 'en') {
    delete out.uiLanguage;
  }

  return out;
}
