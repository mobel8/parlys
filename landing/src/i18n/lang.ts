/**
 * Central i18n constants for the VoiceInk landing.
 *
 * Approach: we render both locales into the HTML at build time and
 * let CSS (`html[data-lang="xx"] [data-i18n-lang="yy"] { display: none; }`)
 * hide the inactive one. A tiny pre-paint script in `BaseLayout.astro`
 * sets `<html data-lang>` before first paint to avoid a FOUC.
 *
 * Why dual-render instead of split builds:
 *   - Zero server / routing cost — a single static bundle handles both
 *   - Toggle is instant: no navigation, no reload, no data loss in
 *     React island state (e.g. the pricing cycle toggle)
 *   - Shared URL structure simplifies social sharing
 *
 * SEO tradeoff: crawlers see BOTH strings, which is suboptimal for
 * pure per-language ranking. For an MVP landing with a known audience
 * (EN and FR — the founder works bilingually), this is acceptable.
 * When we add serious SEO, we migrate to Astro's `i18n` routing and
 * emit `/en/` + `/fr/` as separate static trees.
 */

export type Lang = 'fr' | 'en';

/** The default language. Shown on first visit, or when localStorage is empty. */
export const DEFAULT_LANG: Lang = 'fr';

/** All supported languages, in display order (used by the toggle). */
export const LANGS: readonly Lang[] = ['fr', 'en'] as const;

/** localStorage key — namespaced to avoid clashing with other apps. */
export const LANG_STORAGE_KEY = 'voiceink_lang';

/** Custom event name fired on <window> when the user changes language. */
export const LANG_CHANGE_EVENT = 'voiceink:langchange';

/** Human-readable labels for the toggle UI. */
export const LANG_LABELS: Record<Lang, { short: string; long: string; flag: string }> = {
  fr: { short: 'FR', long: 'Français', flag: '🇫🇷' },
  en: { short: 'EN', long: 'English',  flag: '🇬🇧' },
};
