// Types partagés entre main et renderer

import type { ThemeId, ThemeEffects } from './themes';
export type { ThemeId, ThemeEffects } from './themes';
export { THEMES, THEME_ORDER, DEFAULT_EFFECTS, getTheme } from './themes';

/**
 * Tone modes for dictation post-processing.
 *
 * We intentionally keep this list SHORT — one entry per distinct
 * "manière de parler" the user actually needs. Older modes (`email`,
 * `meeting`, `summary`, `simple`) were either templates that add
 * content the user never dictated (greetings, bullets), length
 * operations rather than tone choices, or redundant with `natural`.
 *
 * Persisted old values are migrated in services/config.ts.
 */
export type Mode =
  | 'raw'
  | 'natural'
  | 'formal'
  | 'message';

/**
 * Prompt templates for each post-processing mode.
 *
 * They use `{{LANG}}` as a placeholder for the human-readable language
 * name ("French", "English", "Japanese"…) injected at runtime by
 * `postProcess()` based on whatever Whisper detected (or the user
 * explicitly selected).
 *
 * The prompts are deliberately written in English because every major
 * LLM (Groq llama-3.3, GPT-4o, Claude, Ollama models) follows English
 * instructions more reliably than localised ones. Experimentally, a
 * French system prompt biases the output language even when told "keep
 * the original language" — so we state the language twice, once as a
 * hard instruction ("RESPOND IN {{LANG}}") and once as context.
 *
 * Every prompt ends with an anti-preamble clause because Llama-style
 * models love to prepend things like "Here is the rewritten text:".
 *
 * Every non-raw prompt MUST:
 *  1. Preserve every fact, number, name and date the user dictated.
 *  2. Never translate. {{LANG}} in = {{LANG}} out.
 *  3. Never add greetings, sign-offs, bullets, or structure the user
 *     didn't dictate. The user's intent matters more than the template.
 *  4. Return ONLY the rewritten text — no quotes, no markdown fences,
 *     no "Here is…" preamble.
 */
export const MODE_PROMPTS: Record<Mode, string> = {
  raw: '',

  // --- NATURAL ------------------------------------------------------
  // Lightest touch. Cleans punctuation/typos, strips hesitation fillers.
  // Preserves EVERYTHING else about the user's voice.
  natural:
    `You are cleaning up a dictated voice note in {{LANG}}. RESPOND IN {{LANG}} ONLY — never translate.` +
    ` Your ONLY job: fix punctuation, capitalisation, obvious typos, and remove hesitation fillers.` +
    ` In French remove: "euh, heu, ben, bah, mmh, ouais, voilà, du coup, enfin, alors, quoi" (especially at sentence boundaries).` +
    ` In English remove: "um, uh, er, like, you know, I mean, so" (when used as fillers).` +
    ` Equivalents in other languages.` +
    ` PRESERVE the user's voice, vocabulary, sentence structure, tone, register and level of detail EXACTLY.` +
    ` DO NOT rephrase, summarise, shorten, elaborate, add politeness, change the register, or split/merge sentences beyond basic punctuation.` +
    ` Keep every fact, number, name and date intact. If the user stutters a word ("je je pense"), keep only one copy.` +
    ` OUTPUT: return ONLY the cleaned text. No preamble, no quotes, no markdown fences, no commentary.`,

  // --- FORMAL -------------------------------------------------------
  // The output must FEEL formal at a glance — elevated vocabulary and
  // complete syntax, not just the same sentence with punctuation.
  // Earlier versions were too timid: for an input like "je pense que
  // demain on pourrait faire la réunion à dix heures" they yielded
  // "Je pense que demain, on pourrait faire la réunion à dix heures",
  // which is identical in register. The explicit substitutions and the
  // tighter 85-130% word-count window below push the model to REWORD
  // while still forbidding any content addition.
  formal:
    `You are rewriting a dictated voice note into a clearly formal, professional register in {{LANG}}. RESPOND IN {{LANG}} ONLY — never translate.` +
    ` The reader should immediately perceive it as formal written language (administrative, professional, academic) — not just the same sentence with punctuation.` +
    ` TRANSFORMATIONS:` +
    ` (1) Remove every filler ("euh, heu, ben, voilà, du coup, enfin, bon, quoi" in French; "um, uh, like, you know, I mean, so" in English; equivalents elsewhere) and every colloquialism.` +
    ` (2) No contractions or elisions. French: "j'sais" → "je sais", "y'a" → "il y a", "t'as" → "tu as", "ça" → "cela" when appropriate. English: "don't" → "do not", "can't" → "cannot", "I'm" → "I am". Similar in other languages.` +
    ` (3) Prefer formal vocabulary. French: "souhaiter/désirer" over "vouloir" when polite intent, "effectuer/réaliser" over "faire", "concernant/au sujet de" over "pour/à propos de", "indiquer/préciser" over "dire", "procéder à" for actions, "prochainement" over "bientôt", "également" over "aussi", "toutefois/cependant" over "mais", "il convient de / il est nécessaire de" over "faut". English: "regarding" over "about", "require" over "need", "approximately" over "around", "however" over "but", "in order to" over "to".` +
    ` (4) Complete every elided subject+verb. French: "Faut vérifier" → "Il convient de vérifier"; "Va falloir" → "Il sera nécessaire de". English: "Gonna check" → "I am going to check"; "Wanna" → "I would like to".` +
    ` (5) Use proper punctuation AND well-formed sentences. Split run-on phrases into multiple sentences when appropriate.` +
    ` HARD CONSTRAINTS:` +
    ` (a) DO NOT ADD CONTENT. Never add greetings ("Bonjour", "Madame", "Dear…"), sign-offs ("Cordialement", "Je vous prie", "Best regards"), closing phrases ("merci d'avance", "please take note", "Je reste à votre disposition"), administrative openers ("Je vous informe que", "Il est porté à votre connaissance que", "I would like to confirm that"), or ANY sentence the user did not dictate.` +
    ` (b) The output must contain EXACTLY the same facts, numbers, names, dates and intent as the input. Nothing more, nothing less.` +
    ` (c) Output must contain the SAME NUMBER of distinct statements/ideas as the input. If the input conveys 2 ideas, the output conveys 2 ideas — never 3, never 4. You are REWORDING each statement individually, not WRITING a formal version of the topic.` +
    ` (d) DO NOT append "Il convient de préciser que…", "Il est également nécessaire de…", "Il y a lieu de noter que…" or any similar meta-statement that wraps or comments on the content. Those phrases add a fabricated sentence and are forbidden unless the user literally dictated that thought.` +
    ` WORKED EXAMPLE — correct vs incorrect:` +
    ` Input: "je pense qu'on devrait faire la réunion demain à dix heures et parler du projet Alpha qui avance bien".` +
    ` CORRECT output (2 ideas, 2 sentences): "Je pense qu'il serait préférable de tenir la réunion demain à dix heures. Nous pourrions également aborder le projet Alpha, qui progresse de manière satisfaisante."` +
    ` INCORRECT output (adds a fabricated 3rd sentence): "…Il convient de préciser que les détails de ce projet seront abordés lors de cette réunion." ← the user never dictated that.` +
    ` OUTPUT: return ONLY the rewritten text. No preamble, no quotes, no markdown, no commentary.`,

  // --- MESSAGE ------------------------------------------------------
  // SHORT chat message. The anti-hallucination clauses are deliberately
  // explicit because earlier tests saw "j'ai aussi des nouvelles sur le
  // projet Alpha" inserted into outputs when the user never said
  // anything about "news". The model MUST compress by deleting, not by
  // paraphrasing in a way that invents context.
  message:
    `You are compressing a dictated voice note into a short, natural chat message in {{LANG}}. RESPOND IN {{LANG}} ONLY — never translate.` +
    ` Target length: 1 to 3 sentences. Conversational tone — NOT formal. Contractions and everyday wording are welcome.` +
    ` Your job is to CUT. Aggressively remove fillers, hedges, repetitions and redundant phrasing.` +
    ` HARD CONSTRAINTS:` +
    ` (a) NEVER add content that wasn't in the input. NO "j'ai des nouvelles", "je voulais te dire que", "pour faire le point", "quick update:", "FYI:" unless the user actually dictated those words. No greetings, no closings, no emoji, no introductory framing.` +
    ` (b) NEVER paraphrase in a way that invents context. If the user said "la réunion à dix heures", do NOT turn it into "on se voit à dix heures pour faire le point" — that added "pour faire le point". Keep the user's own words wherever possible.` +
    ` (c) Compress by DELETING, not by rephrasing into vaguer terms.` +
    ` (d) Preserve EVERY fact, number, name, date, place, and person the user mentioned — including any specifics that seem small.` +
    ` OUTPUT: return ONLY the message text. No preamble, no quotes, no markdown, no commentary.`,
};

/**
 * Custom dictionary entry — a word/phrase the user dictates and wants
 * replaced by a different (usually formatted) target. Applied after Whisper,
 * before translation + LLM. See `src/main/services/replacements.ts`.
 */
export interface Replacement {
  id: string;
  from: string;            // trigger (what the user says / what Whisper returns)
  to: string;              // output text
  caseSensitive: boolean;  // default false
  wholeWord: boolean;      // default true — match word boundaries only
  enabled: boolean;
}

export type Density = 'comfortable' | 'compact';

export interface WidgetBounds {
  x: number;
  y: number;
}

/**
 * TTS providers for the voice interpreter feature. Each one exposes an
 * MP3 streaming endpoint so the renderer can start playback before the
 * full utterance is synthesised. See `src/main/engines/tts/*.ts`.
 *
 *   - cartesia    : Sonic-2 via WebSocket. Cheapest (~$0.015/1k chars),
 *                   lowest TTFB (~40ms), high-quality voice cloning.
 *   - elevenlabs  : Flash v2.5 via HTTP chunked. Highest perceived
 *                   naturalness (~$0.30/1k chars), ~75ms TTFB.
 *   - openai      : gpt-4o-mini-tts via HTTP chunked. 50+ languages,
 *                   moderate naturalness (~$0.015/1k chars).
 */
export type TTSProvider = 'cartesia' | 'elevenlabs' | 'openai';

export interface Settings {
  groqApiKey: string;
  sttModel: string;       // groq whisper model id
  language: string;       // 'auto' | 'fr' | 'en' | ...
  translateTo: string;    // '' = no translation, else ISO code
  mode: Mode;
  llmEnabled: boolean;
  llmProvider: 'groq' | 'openai' | 'anthropic' | 'ollama';
  llmModel: string;
  llmApiKey: string;
  translateModel: string; // Groq model used for translation
  autoInject: boolean;
  autoCopy: boolean;
  shortcutToggle: string; // Electron accelerator
  shortcutPTT: string;    // Push-to-talk accelerator (press-and-hold)
  pttEnabled: boolean;    // Enable push-to-talk shortcut
  /**
   * Global accelerator that flips `interpreterEnabled` on/off without
   * having to open Settings. Lets the user enable the voice translator
   * with a single key combo from anywhere on the OS. Empty = unbound.
   * Default: `CommandOrControl+Shift+I`.
   */
  shortcutInterpreter: string;
  /**
   * UI language of the VoiceInk app itself (menus, labels, buttons).
   * Completely independent of `language` (which hints Whisper what
   * language the USER is speaking). `'auto'` resolves at runtime to
   * the OS/browser locale — see `src/shared/i18n.ts::resolveUILanguage`.
   * Default: 'auto'. Shipping with FR + EN at launch; more locales are
   * additive (just add a dictionary in i18n.ts, no other code change).
   */
  uiLanguage: 'auto' | 'fr' | 'en';
  /** Visual theme — palette ID (see `src/shared/themes.ts`). */
  themeId: ThemeId;
  /** Visual effects (glow intensity, blur, animations…). */
  themeEffects: ThemeEffects;
  /** Custom dictionary — applied after Whisper, before translation + LLM. */
  replacements: Replacement[];
  replacementsEnabled: boolean;
  density: Density;             // 'comfortable' (main window) or 'compact' (floating pill)
  alwaysOnTop: boolean;         // Always-on-top in comfortable mode (pill is always on top)
  widgetBounds: WidgetBounds | null; // Last pill position (persisted across launches)
  /** Launch VoiceInk at Windows startup. */
  autoStart: boolean;
  /** Start minimized to tray (no window visible on launch). */
  startMinimized: boolean;
  /** Play subtle audio cues on start/stop/done. */
  soundsEnabled: boolean;

  // --- Voice interpreter ------------------------------------------------
  /**
   * When enabled, the primary record button routes through the
   * interpreter pipeline (Whisper → translate → TTS) instead of the
   * classic dictation pipeline (Whisper → LLM post-process → clipboard).
   * Independent of `mode` — the 4 dictation modes keep working when
   * this toggle is OFF.
   */
  interpreterEnabled: boolean;
  /**
   * Target language (ISO 639-1) for the interpreter. When empty, falls
   * back to `translateTo`, then to a safe default ('en').
   */
  interpretTargetLang: string;
  /**
   * Continuous mode — enables VAD-based chunking so the interpreter can
   * start speaking the translation while the user is still talking.
   * Off by default (single push-to-stop, then one utterance).
   */
  interpreterContinuous: boolean;
  /** TTS provider used by the interpreter. */
  ttsProvider: TTSProvider;
  /** Per-provider voice ID. Keyed by provider so users can pick a voice per brand. */
  ttsVoiceId: Partial<Record<TTSProvider, string>>;
  /** Per-provider API keys. Keyed by provider. */
  ttsApiKey: Partial<Record<TTSProvider, string>>;
  /**
   * Pronunciation speed multiplier. 1.0 = natural. Applied server-side
   * when the provider supports it (ElevenLabs `speed` param, Cartesia
   * `speed`), otherwise ignored.
   */
  ttsSpeed: number;
  /**
   * Global master switch for spoken output. When OFF, the interpreter
   * and listener still produce the translated *text*, but the main
   * process skips every TTS call entirely — saving Cartesia/ElevenLabs
   * credits and avoiding any audio playback. Orthogonal to
   * `listenerMode`: if this master is OFF, the listener's "audio"
   * preset is silenced just like the interpreter.
   */
  speakTranslations: boolean;
  /**
   * Audio output device ID (as returned by MediaDevices.enumerateDevices).
   * Empty = default speakers. Set to a virtual-mic deviceId (VB-Cable,
   * VoiceMeeter, Krisp…) to route the translated audio to Discord /
   * Zoom / Meet as if it were coming from your microphone.
   */
  ttsSinkId: string;

  // --- Listener (inbound conversation) ----------------------------------
  /**
   * Enable listener mode — captures audio from a device (system loopback
   * or a secondary mic) and transcribes it in real time so the user can
   * *understand* someone else in another language. Orthogonal to
   * interpreter mode.
   */
  listenerEnabled: boolean;
  /**
   * Audio input device ID used by the listener. Empty = default mic.
   * Typically set to a loopback device ("Stereo Mix", "VB-Cable
   * Output") so the listener captures the remote caller's voice rather
   * than your own mic.
   */
  listenerInputDeviceId: string;
  /** Target language (ISO 639-1) for listener translation. */
  listenerTargetLang: string;
  /**
   * 'text' (default) = only transcribe and display on screen,
   * 'audio'          = also synthesize TTS of the translation.
   */
  listenerMode: 'text' | 'audio';
}

export const DEFAULT_SETTINGS: Settings = {
  groqApiKey: '',
  sttModel: 'whisper-large-v3-turbo',
  language: 'auto',
  translateTo: '',
  mode: 'raw',
  llmEnabled: false,
  llmProvider: 'groq',
  llmModel: 'llama-3.3-70b-versatile',
  llmApiKey: '',
  translateModel: 'llama-3.1-8b-instant',
  autoInject: true,
  autoCopy: true,
  shortcutToggle: 'CommandOrControl+Shift+Space',
  shortcutPTT: 'CommandOrControl+Shift+V',
  shortcutInterpreter: 'CommandOrControl+Shift+I',
  uiLanguage: 'auto',
  pttEnabled: false,
  themeId: 'midnight',
  themeEffects: {
    glowIntensity: 65,
    blurStrength: 18,
    animateAura: true,
    auraEnabled: true,
    shimmer: true,
    grain: false,
  },
  replacements: [],
  replacementsEnabled: true,
  density: 'comfortable',
  alwaysOnTop: false,
  widgetBounds: null,
  autoStart: false,
  startMinimized: false,
  soundsEnabled: false,
  interpreterEnabled: false,
  interpretTargetLang: 'en',
  interpreterContinuous: false,
  ttsProvider: 'cartesia',
  ttsVoiceId: {
    // Sonic-2 "Professional Woman" — multilingual, natural warmth.
    cartesia: '794f9389-aac1-45b6-b726-9d9369183238',
    // ElevenLabs "Rachel" — premade voice, works in 32 languages.
    elevenlabs: '21m00Tcm4TlvDq8ikWAM',
    // OpenAI "alloy" — neutral, balanced.
    openai: 'alloy',
  },
  ttsApiKey: {},
  ttsSpeed: 1.0,
  ttsSinkId: '',
  speakTranslations: true,
  listenerEnabled: false,
  listenerInputDeviceId: '',
  listenerTargetLang: 'fr',
  listenerMode: 'text',
};

export interface HistoryEntry {
  id: string;
  createdAt: number;
  rawText: string;
  finalText: string;
  mode: Mode;
  language: string;
  translatedTo?: string;   // if translation happened
  durationMs: number;
  audioMs: number;
  tags: string[];
  pinned?: boolean;        // user-pinned favourites float to top
  wordCount?: number;      // computed on insert for stats
}

export interface UsageStats {
  totalEntries: number;
  totalWords: number;
  totalChars: number;
  totalDurationMs: number;
  byLanguage: Record<string, number>;
  byMode: Record<string, number>;
  first?: number;          // first createdAt
  last?: number;           // last createdAt
  streakDays: number;      // consecutive days with at least one dictation
}

export interface TranscribeRequest {
  audioBase64: string;     // base64 (no data URL prefix)
  mimeType: string;        // 'audio/webm' etc
  language?: string;       // ISO code or undefined
  translateTo?: string;    // target language, overrides settings
  mode: Mode;
}

export interface TranscribeResponse {
  ok: boolean;
  rawText: string;
  finalText: string;
  detectedLanguage?: string;
  translatedTo?: string;
  durationMs: number;
  error?: string;
}

/**
 * Interpreter request — same audio payload as a normal transcription
 * but signals the main process to route through the TTS pipeline and
 * stream audio chunks back over `IPC.ON_INTERPRET_CHUNK`. The renderer
 * assembles those chunks into a playable MP3 stream.
 */
export interface InterpretRequest {
  /** Unique session id so the renderer can correlate inbound chunks. */
  requestId: string;
  audioBase64: string;
  mimeType: string;
  /** Source language (ISO 639-1). 'auto' or empty → let Whisper detect. */
  sourceLang?: string;
  /** Target language (ISO 639-1). */
  targetLang: string;
}

export interface InterpretResponse {
  ok: boolean;
  requestId: string;
  /** The transcribed (source-language) text. */
  rawText: string;
  /** The translated (target-language) text fed to the TTS. */
  translatedText: string;
  detectedLanguage?: string;
  durationMs: number;
  /** Milliseconds between end-of-audio and first audio chunk emitted. */
  ttfbMs?: number;
  error?: string;
}

/**
 * Audio chunk event pushed from main to renderer during an interpret
 * session. The renderer assembles these in order (by `seq`) into an
 * MP3 blob it pipes to the Web Audio API via MediaSource.
 */
export interface InterpretChunkEvent {
  requestId: string;
  seq: number;
  /** Base64-encoded raw bytes of the MP3 chunk. */
  chunkBase64: string;
  /** MIME type of the chunk (`audio/mpeg` for all 3 providers). */
  mime: string;
  /** True when this is the final chunk of the session. */
  done: boolean;
  /** Terminal error if the stream aborted mid-flight. */
  error?: string;
}

/**
 * Per-provider voice metadata surfaced by the voice catalog IPC so
 * the UI can render a rich filterable picker instead of a dumb
 * `<select>`. Shape stays stable across providers; missing fields
 * degrade gracefully in the picker.
 */
export interface VoiceInfo {
  id: string;
  name: string;
  description?: string;
  language?: string;
  gender?: 'masculine' | 'feminine' | 'neutral';
  accent?: string;
  preview_url?: string;
  pro?: boolean;
}

/**
 * Listener mode types — real-time transcription of incoming audio
 * (another person's voice, system loopback, etc.) with optional
 * on-the-fly translation. Designed for conversation scenarios where
 * the user wants to *understand* someone else in another language.
 */
export interface ListenerSegment {
  /** Monotonically increasing id, used for React keys and ordering. */
  id: string;
  /** Timestamp (epoch ms) when the segment was captured. */
  ts: number;
  /** Detected source language, ISO code. */
  sourceLang?: string;
  /** Raw transcription in the source language. */
  text: string;
  /** Translated text in target language (same as text if sourceLang === targetLang). */
  translated?: string;
  /** Duration of the captured audio in ms. */
  audioMs: number;
  /** True while the main process is still synthesizing TTS for this segment. */
  speaking?: boolean;
}

export const IPC = {
  TRANSCRIBE: 'voiceink:transcribe',
  INTERPRET: 'voiceink:interpret',
  ON_INTERPRET_CHUNK: 'voiceink:interpretChunk',
  LIST_VOICES: 'voiceink:listVoices',
  LISTENER_TRANSCRIBE: 'voiceink:listenerTranscribe',
  SPEAK: 'voiceink:speak',
  PREWARM: 'voiceink:prewarm',
  GET_SETTINGS: 'voiceink:getSettings',
  SET_SETTINGS: 'voiceink:setSettings',
  GET_HISTORY: 'voiceink:getHistory',
  ADD_HISTORY: 'voiceink:addHistory',
  DELETE_HISTORY: 'voiceink:deleteHistory',
  CLEAR_HISTORY: 'voiceink:clearHistory',
  INJECT_TEXT: 'voiceink:injectText',
  COPY_TEXT: 'voiceink:copyText',
  EXPORT: 'voiceink:export',
  ON_TOGGLE_RECORDING: 'voiceink:onToggleRecording',
  ON_SETTINGS_OPEN: 'voiceink:onSettingsOpen',
  /**
   * Broadcast from main to every renderer whenever a setting changes —
   * whether via the UI (SET_SETTINGS round-trip) or via a global
   * accelerator (e.g. shortcutInterpreter flipping interpreterEnabled).
   * Payload: the FULL new Settings object so the receiver can just
   * `set({ settings: next })` without another round-trip.
   */
  ON_SETTINGS_CHANGED: 'voiceink:onSettingsChanged',
  WINDOW_MINIMIZE: 'voiceink:windowMinimize',
  WINDOW_CLOSE: 'voiceink:windowClose',
  WINDOW_MAXIMIZE: 'voiceink:windowMaximize',
  WINDOW_SET_ALWAYS_ON_TOP: 'voiceink:windowSetAlwaysOnTop',
  WINDOW_RESIZE_FOR_DENSITY: 'voiceink:windowResizeForDensity',
  WIDGET_CONTEXT_MENU: 'voiceink:widgetContextMenu',
  TOGGLE_PIN_HISTORY: 'voiceink:togglePinHistory',
  EXPORT_HISTORY: 'voiceink:exportHistory',
  GET_USAGE_STATS: 'voiceink:getUsageStats',
  SET_AUTO_START: 'voiceink:setAutoStart',
  ON_PTT_DOWN: 'voiceink:onPttDown',
  ON_PTT_UP: 'voiceink:onPttUp',
  LOG: 'voiceink:log',
  /* ─── Auto-updater (see src/main/updater.ts) ─────────────────── */
  /** Renderer → main : check for updates manually (button in Settings). */
  UPDATER_CHECK: 'voiceink:updaterCheck',
  /** Renderer → main : accept & install a downloaded update (quit & install). */
  UPDATER_INSTALL: 'voiceink:updaterInstall',
  /** Renderer → main : poll current updater state (after app reload). */
  UPDATER_GET_STATE: 'voiceink:updaterGetState',
  /** Main → renderer : state transitions (idle / checking / available / downloading / ready / error). */
  ON_UPDATER_STATE: 'voiceink:onUpdaterState',
} as const;

/**
 * Auto-updater state machine. Emitted by `src/main/updater.ts` via
 * `ON_UPDATER_STATE`. The renderer displays a banner/toast depending
 * on `phase` and surfaces the progress bar while `phase === 'downloading'`.
 *
 * Phases:
 * - `idle` : nothing in flight, no update pending
 * - `checking` : `autoUpdater.checkForUpdates()` in progress
 * - `up-to-date` : check completed, no newer version on the feed
 * - `available` : newer version found, download is about to start
 * - `downloading` : download active — `progress` is populated
 * - `ready` : download complete, user can click "Install & restart"
 * - `error` : something went wrong — `error` contains the message
 */
export interface UpdaterState {
  phase: 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'error';
  /** Version string of the available/ready update (e.g. "1.8.0"). */
  version?: string;
  /** Download progress 0-100 when `phase === 'downloading'`. */
  progress?: number;
  /** Bytes transferred / total, only during download (for optional display). */
  transferred?: number;
  total?: number;
  /** Human-readable error when `phase === 'error'`. */
  error?: string;
}
