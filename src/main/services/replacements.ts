/**
 * Custom dictionary / replacements engine.
 *
 * Applied server-side (main process) after Whisper transcription and before
 * translation + LLM post-processing. This lets users correct systematic
 * misrecognitions ("Groc" → "Groq") OR expand verbal shortcuts they use
 * instead of typing punctuation ("virgule" → ",", "nouvelle ligne" → "\n").
 *
 * Design choices:
 *   - `wholeWord` uses Unicode-aware boundaries so it works for French,
 *     accented characters, etc.
 *   - Case-insensitive by default (matches the common case — dictation
 *     produces lowercase/capitalised variants we want to collapse).
 *   - Longest `from` is applied first so overlapping rules are deterministic
 *     ("nouvelle ligne" wins over "ligne").
 *   - We escape all regex metacharacters in `from` — users aren't writing
 *     regex, they're writing literal phrases.
 */

import { Replacement } from '../../shared/types';

/** Escape a literal string for safe embedding into a RegExp. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Apply the user's active replacements to `text`.
 * Returns the transformed text (same reference if nothing matched, for tiny
 * caller optimisations).
 *
 * Special tokens in the `to` field:
 *   \n → newline, \t → tab  (so users can dictate "nouvelle ligne" → real newline)
 */
export function applyReplacements(text: string, replacements: Replacement[] | undefined): string {
  if (!text || !replacements || !replacements.length) return text;

  // Keep only enabled & non-empty rules, sorted by `from` length desc so
  // longer phrases match before shorter ones.
  const active = replacements
    .filter((r) => r.enabled && r.from && r.from.trim().length > 0)
    .sort((a, b) => b.from.length - a.from.length);

  if (!active.length) return text;

  let out = text;

  for (const rule of active) {
    try {
      const flags = rule.caseSensitive ? 'g' : 'gi';
      const pattern = rule.wholeWord
        // `\b` is ASCII-only in JS; fall back to lookarounds that consider
        // any non-letter/number (incl. accents) as a boundary.
        ? new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(rule.from)}(?![\\p{L}\\p{N}])`, flags + 'u')
        : new RegExp(escapeRegex(rule.from), flags);

      const target = expandEscapes(rule.to);
      out = out.replace(pattern, target);
    } catch (err: any) {
      console.warn(`[replacements] skipping invalid rule "${rule.from}":`, err?.message || err);
    }
  }

  return out;
}

/** Support \n and \t in the target text (stored as literal backslash-n). */
function expandEscapes(s: string): string {
  return s.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
}

/**
 * Count words in a string using Unicode-aware boundaries. Returns 0 for
 * empty / whitespace-only input.
 */
export function wordCount(text: string): number {
  if (!text || !text.trim()) return 0;
  // \p{L} = any letter, \p{N} = any digit. Count consecutive runs.
  const matches = text.match(/[\p{L}\p{N}]+/gu);
  return matches ? matches.length : 0;
}

/**
 * French-language preset — common dictation commands users can import with
 * one click. Kept minimal and opinionated so it doesn't fight the user's
 * own style. Each rule is `wholeWord: true` so it won't corrupt running text
 * that happens to contain these words.
 */
export const FRENCH_PRESETS: Omit<Replacement, 'id'>[] = [
  { from: 'virgule', to: ',', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'point virgule', to: ';', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'deux points', to: ' :', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'point final', to: '.', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'point d interrogation', to: ' ?', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'point d exclamation', to: ' !', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'nouvelle ligne', to: '\\n', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'nouveau paragraphe', to: '\\n\\n', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'guillemets ouvrants', to: ' « ', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'guillemets fermants', to: ' » ', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'arobase', to: '@', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'dièse', to: '#', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'tiret', to: '-', caseSensitive: false, wholeWord: true, enabled: true },
];

/** English-language preset. */
export const ENGLISH_PRESETS: Omit<Replacement, 'id'>[] = [
  { from: 'comma', to: ',', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'period', to: '.', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'full stop', to: '.', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'question mark', to: '?', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'exclamation mark', to: '!', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'new line', to: '\\n', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'new paragraph', to: '\\n\\n', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'at sign', to: '@', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'hashtag', to: '#', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'dash', to: '-', caseSensitive: false, wholeWord: true, enabled: true },
];
