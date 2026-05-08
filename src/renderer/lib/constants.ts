import { Mic, Leaf, Briefcase, MessageSquare, type LucideIcon } from 'lucide-react';
import { Mode } from '../../shared/types';

/**
 * Per-mode presentation data.
 *
 *   - label : short French name shown in dropdowns.
 *   - desc  : one-line description for settings / tooltips.
 *   - icon  : emoji string. Kept because <option> elements and the
 *             history-badge can't render React components, so those two
 *             call sites inline the emoji directly. Persisted history
 *             entries also still reference this field shape.
 *   - Icon  : Lucide React component. Used by <ModePicker> in MainView
 *             so the chip swaps its leading icon when the user changes
 *             mode, matching the rest of the picker chips (language,
 *             translate) which all use Lucide line icons.
 *
 * The four emojis below are deliberately picked from Emoji 1.0 (2010),
 * single-codepoint, no variation selector (VS16). That combination
 * renders correctly on every Windows 10+ build without depending on
 * the Emoji 13.0 data file. Any fancier emoji (🪶 feather 2020, 🖋️
 * fountain pen with VS16) triggered tofu rectangles on some systems.
 *
 *   raw     → 🎤  + Mic          (voice captured as-is, no post-processing)
 *   natural → 🍃  + Leaf         (natural, light flow of speech)
 *   formal  → 🎤  + Briefcase    (professional, elevated register)
 *   message → 💬  + MessageSquare (compressed, conversational chat reply)
 */
export const MODE_LABELS: Record<Mode, {
  label: string;
  desc: string;
  icon: string;
  Icon: LucideIcon;
}> = {
  raw:     { label: 'Brut',    desc: 'Transcription exacte, aucun post-traitement',            icon: '🎤', Icon: Mic },
  natural: { label: 'Naturel', desc: 'Ponctuation + retrait des hésitations, voix intacte',    icon: '🍃', Icon: Leaf },
  formal:  { label: 'Formel',  desc: 'Registre soutenu, vocabulaire élevé, phrases complètes', icon: '👔', Icon: Briefcase },
  message: { label: 'Message', desc: 'Compression courte, conversationnel, 1 à 3 phrases',    icon: '💬', Icon: MessageSquare },
};

export const SUPPORTED_LANGUAGES = [
  { code: 'auto', label: 'Détection auto' },
  { code: 'fr', label: 'Français' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'pt', label: 'Português' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'pl', label: 'Polski' },
  { code: 'ru', label: 'Русский' },
  { code: 'ja', label: '日本語' },
  { code: 'zh', label: '中文' },
  { code: 'ko', label: '한국어' },
  { code: 'ar', label: 'العربية' },
];

export const GROQ_STT_MODELS = [
  { id: 'whisper-large-v3-turbo', label: 'Whisper Large v3 Turbo (rapide, recommandé)' },
  { id: 'whisper-large-v3', label: 'Whisper Large v3 (précis)' },
  { id: 'distil-whisper-large-v3-en', label: 'Distil Whisper (anglais only)' },
];

/**
 * Targets available for automatic translation. Empty code = no translation.
 * Uses native language names so the user recognises them instantly.
 */
export const TRANSLATE_TARGETS = [
  { code: '',   label: 'Aucune (garder la langue d\'origine)', native: '' },
  { code: 'fr', label: 'Français',  native: 'Français' },
  { code: 'en', label: 'English',   native: 'English' },
  { code: 'es', label: 'Español',   native: 'Español' },
  { code: 'de', label: 'Deutsch',   native: 'Deutsch' },
  { code: 'it', label: 'Italiano',  native: 'Italiano' },
  { code: 'pt', label: 'Português', native: 'Português' },
  { code: 'nl', label: 'Nederlands',native: 'Nederlands' },
  { code: 'pl', label: 'Polski',    native: 'Polski' },
  { code: 'ru', label: 'Русский',   native: 'Русский' },
  { code: 'ja', label: '日本語',      native: '日本語' },
  { code: 'zh', label: '中文',       native: '中文' },
  { code: 'ko', label: '한국어',       native: '한국어' },
  { code: 'ar', label: 'العربية',     native: 'العربية' },
];

export const LANGUAGE_NAMES: Record<string, string> = {
  fr: 'French', en: 'English', es: 'Spanish', de: 'German',
  it: 'Italian', pt: 'Portuguese', nl: 'Dutch', pl: 'Polish',
  ru: 'Russian', ja: 'Japanese', zh: 'Chinese', ko: 'Korean',
  ar: 'Arabic',
};

/**
 * TTS provider catalog. Each provider declares:
 *   - `label` / `desc` : localised marketing copy.
 *   - `keyUrl`         : where the user gets their API key.
 *   - `voices`         : list of {id, name, langs} for the picker. We
 *                        ship a short curated list — power users can
 *                        paste a custom voice id in the input next to
 *                        the picker.
 */
export const TTS_PROVIDERS: Array<{
  id: 'cartesia' | 'elevenlabs' | 'openai';
  label: string;
  desc: string;
  keyUrl: string;
  voices: Array<{ id: string; name: string; langs: string }>;
}> = [
  {
    id: 'cartesia',
    label: 'Cartesia Sonic-2',
    desc: 'Ultra-rapide (~40 ms TTFB), voix réalistes, très économique.',
    keyUrl: 'https://play.cartesia.ai/keys',
    voices: [
      { id: '794f9389-aac1-45b6-b726-9d9369183238', name: 'Professional Woman', langs: 'multi' },
      { id: 'a0e99841-438c-4a64-b679-ae501e7d6091', name: 'Barbershop Man',     langs: 'en, fr' },
      { id: '156fb8d2-335b-4950-9cb3-a2d33befec77', name: 'Help Desk Man',      langs: 'en, fr, es' },
      { id: '2ee87190-8f84-4925-97da-e52547f9462c', name: 'Child',              langs: 'multi' },
      { id: '87748186-23bb-4158-a1eb-332911b0b708', name: 'British Lady',       langs: 'en' },
      { id: 'a3788b92-e7be-4c37-9927-3c0e5e9f8d6d', name: 'Friendly French Man', langs: 'fr' },
      { id: '65b25c5d-ff07-4687-a04c-da2f43ef6fa9', name: 'French Man',          langs: 'fr' },
    ],
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs Flash v2.5',
    desc: 'Qualité studio, voix quasi humaines, TTFB ~75 ms.',
    keyUrl: 'https://elevenlabs.io/app/settings/api-keys',
    voices: [
      { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel (F)',   langs: 'multi' },
      { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi (F)',     langs: 'multi' },
      { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah (F)',    langs: 'multi' },
      { id: 'pNInz6obpgDQGBFmaJiz', name: 'Adam (M)',     langs: 'multi' },
      { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam (M)',     langs: 'multi' },
      { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel (M)',   langs: 'multi' },
      { id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte (F)', langs: 'multi' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI gpt-4o-mini-tts',
    desc: '50+ langues, très économique, TTFB ~200 ms.',
    keyUrl: 'https://platform.openai.com/api-keys',
    voices: [
      { id: 'alloy',   name: 'Alloy (neutre)',     langs: 'multi' },
      { id: 'nova',    name: 'Nova (F, chaleureuse)', langs: 'multi' },
      { id: 'shimmer', name: 'Shimmer (F, douce)',   langs: 'multi' },
      { id: 'coral',   name: 'Coral (F, expressive)', langs: 'multi' },
      { id: 'echo',    name: 'Echo (M)',           langs: 'multi' },
      { id: 'onyx',    name: 'Onyx (M, grave)',    langs: 'multi' },
      { id: 'fable',   name: 'Fable (M, narratif)', langs: 'multi' },
      { id: 'ballad',  name: 'Ballad (M)',         langs: 'multi' },
      { id: 'ash',     name: 'Ash (M)',            langs: 'multi' },
      { id: 'sage',    name: 'Sage (F)',           langs: 'multi' },
      { id: 'verse',   name: 'Verse (M)',          langs: 'multi' },
    ],
  },
];

/**
 * Interpreter target language list. Reuses the same codes as
 * TRANSLATE_TARGETS but always defaults to a real language (no empty
 * "none" option — the interpreter needs a target to speak).
 */
export const INTERPRETER_LANGUAGES = TRANSLATE_TARGETS
  .filter((t) => t.code !== '')
  .map((t) => ({ code: t.code, label: t.native }));
