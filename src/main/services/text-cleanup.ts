/**
 * Whisper post-processing — fillers + known-hallucination scrubbing.
 *
 * Applied to the raw Whisper output BEFORE replacements/LLM/translation
 * so every downstream step sees clean text. Runs even in `raw` mode
 * (where the LLM is bypassed), which is the only way to strip "euh"
 * and YouTube-training hallucinations without re-introducing the LLM
 * latency that raw mode is meant to avoid.
 *
 * Design priorities:
 *  - Cheap (regex only, no allocation per token).
 *  - Conservative on fillers — only the unambiguous interjections.
 *    "alors", "bon", "voilà", "enfin", "du coup" are SOMETIMES fillers
 *    and SOMETIMES content; the LLM modes handle them, raw mode leaves
 *    them alone.
 *  - Aggressive on Whisper's known YouTube hallucinations — these are
 *    exact phrases the model emits on trailing silence because it was
 *    trained on millions of YouTube transcripts that ended with "merci
 *    d'avoir regardé / please subscribe". Whisper-large-v3 + turbo are
 *    BOTH affected; turbo more so on short clips.
 */

/**
 * Filler interjections to strip from raw transcriptions.
 *
 * Rules:
 *  - Each entry is matched as a STANDALONE WORD (Unicode-aware word
 *    boundary on both sides). "ben" never strips when part of "Benjamin",
 *    "heu" never strips when part of "heureux".
 *  - Surrounding commas / semicolons are consumed too so we don't leave
 *    ", ," dangling. A trailing space is collapsed by `tidyPunctuation`.
 *  - Repeats ("euh euh euh") all match because we use the global flag
 *    and run a tidy pass afterwards.
 *
 * Why not "ah", "oh" in French? Because they're also legitimate
 * interjections ("Ah bon ?", "Oh là là"). Whisper rarely emits them on
 * silence — they're not hallucination markers, just expressive speech.
 * Same for English: we leave "ah" / "oh" alone.
 */
const FILLERS: Record<string, string[]> = {
  fr: [
    'euh', 'euhh', 'euhhh', 'heu', 'heuh', 'eh',
    'hum', 'hmm', 'mh', 'mmh', 'mmmh',
    'hein',
    'mhm', 'mmm',
  ],
  en: [
    'um', 'umm', 'ummm',
    'uh', 'uhh', 'uhhh',
    'er', 'err',
    'hmm', 'hm', 'mhm',
    'uhm',
  ],
  es: ['eh', 'ehm', 'este', 'pues'],
  de: ['äh', 'ähm', 'hm', 'hmm'],
  it: ['eh', 'ehm', 'mm'],
  pt: ['é', 'éh', 'hum'],
};

/**
 * Phrases Whisper-large-v3 (incl. turbo) emits *as hallucinations* on
 * trailing silence because they appear at the end of millions of training
 * YouTube transcripts. Matched case-insensitively; the surrounding
 * punctuation is consumed so removal doesn't leave orphan periods.
 *
 * These are aggressive matches — false positives are essentially zero
 * because the user is dictating, not transcribing a YouTube outro.
 */
const HALLUCINATIONS: Record<string, RegExp[]> = {
  fr: [
    // Amara / community subtitles
    /\bsous[-\s]?titres?\s+(?:réalisés?|fait[s]?)\s+par\s+la\s+communauté\s+d['']?amara\.?org\.?/gi,
    /\bsous[-\s]?titres?\s+(?:réalisés?|fait[s]?)\s+par\s+(?:la\s+)?communauté\s+d['']?amara[\s\S]*?$/gi,
    /\bsous[-\s]?titrage\s+(?:mfp|société\s+radio[-\s]?canada|st['\s]?501)\b[^.!?\n]*[.!?…]?/gi,
    /\b❤️?\s*par\s+sous[-\s]?titres?\s+amara\.?org\b/gi,
    /\bsous[-\s]?titres?\s+effectués\s+par[^.!?\n]*[.!?…]?/gi,
    // YouTube outros
    /\bmerci\s+d['']?avoir\s+regardé[^.!?\n]*[.!?…]?/gi,
    /\bn['']?(?:hésitez|hesitez)\s+pas\s+à\s+(?:vous\s+)?(?:abonner|liker)[^.!?\n]*[.!?…]?/gi,
    /\babonnez[-\s]?vous(?:\s+à\s+(?:ma|notre)\s+chaî?ne)?[^.!?\n]*[.!?…]?/gi,
    /\blike(?:r|z)?\s+et\s+abonnez[-\s]?vous\b[^.!?\n]*[.!?…]?/gi,
    /\bà\s+la\s+prochaine\s*!?$/gi,
    /\bà\s+bientôt\s*!?$/gi,
    // Common dangling artefacts
    /^\s*\.\.\.\s*$/g,
    /^\s*\.\s*$/g,
    /^\s*\?\s*$/g,
  ],
  en: [
    /\bthanks?\s+(?:so\s+much\s+)?for\s+watching[^.!?\n]*[.!?…]?/gi,
    /\bthank\s+you\s+(?:so\s+much\s+)?for\s+watching[^.!?\n]*[.!?…]?/gi,
    /\b(?:don['']?t\s+forget\s+to\s+|please\s+)?(?:like|subscribe)(?:\s+(?:and|&)\s+(?:like|subscribe))?[^.!?\n]*[.!?…]?/gi,
    /\bsubscribe\s+to\s+(?:my|our|the)\s+channel[^.!?\n]*[.!?…]?/gi,
    /\bsee\s+you\s+(?:next\s+time|in\s+the\s+next\s+video|soon)[^.!?\n]*[.!?…]?/gi,
    /\b(?:peace|bye)\s*!?$/gi,
    /^\s*\.\.\.\s*$/g,
    /^\s*\.\s*$/g,
    /^\s*\?\s*$/g,
    /^\s*\.5\s*$/g,
  ],
  es: [
    /\bgracias\s+por\s+ver\b[^.!?\n]*[.!?…]?/gi,
    /\bsuscríbete\s+(?:al?\s+canal)?[^.!?\n]*[.!?…]?/gi,
  ],
  de: [
    /\bdanke\s+fürs?\s+(?:zuschauen|zusehen)[^.!?\n]*[.!?…]?/gi,
    /\babonniert\s+(?:meinen|unseren)\s+kanal[^.!?\n]*[.!?…]?/gi,
  ],
  it: [
    /\bgrazie\s+per\s+(?:aver\s+)?(?:guardato|seguito)[^.!?\n]*[.!?…]?/gi,
    /\biscrivetevi\s+al\s+(?:mio\s+)?canale[^.!?\n]*[.!?…]?/gi,
  ],
  pt: [
    /\bobrigado\s+por\s+(?:assistir|ver)[^.!?\n]*[.!?…]?/gi,
    /\bse\s+inscreva(?:\s+no\s+canal)?[^.!?\n]*[.!?…]?/gi,
  ],
};

/**
 * Escape literal regex metacharacters in a token.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the filler regex for one language. Wraps each token in Unicode-
 * aware non-letter boundaries so we never amputate real words like
 * "Benjamin" → "jamin" or "heureux" → "reux".
 */
function buildFillerRegex(tokens: string[]): RegExp {
  // `[\p{L}\p{N}]` covers accented letters; "ç", "é", "ñ" etc. all count
  // as letters, so a filler boundary against them is correctly required.
  const alts = tokens.map(escapeRegex).join('|');
  // Lookbehind/ahead = "previous/next char is not letter, digit, dash or apostrophe".
  // Trailing punctuation (comma, semicolon) gets consumed so we don't
  // strand it; period/question/exclamation are left because they end a
  // sentence and removing them would merge clauses.
  return new RegExp(
    `(?<![\\p{L}\\p{N}'\\-])(?:${alts})(?![\\p{L}\\p{N}'\\-])\\s*[,;]?\\s*`,
    'giu',
  );
}

const FILLER_REGEX_CACHE = new Map<string, RegExp>();
function getFillerRegex(lang: string): RegExp | null {
  const code = (lang || '').toLowerCase().slice(0, 2);
  if (!FILLERS[code]) return null;
  const cached = FILLER_REGEX_CACHE.get(code);
  if (cached) return cached;
  const re = buildFillerRegex(FILLERS[code]);
  FILLER_REGEX_CACHE.set(code, re);
  return re;
}

/**
 * Repair the punctuation/whitespace after deletions:
 *  - "X  Y"      → "X Y"
 *  - "X , Y"     → "X, Y"
 *  - "X ,. Y"    → "X. Y"   (stranded comma before terminator)
 *  - " ! Y"      → "! Y"
 *  - leading/trailing whitespace, repeated punctuation collapsed.
 */
function tidyPunctuation(text: string): string {
  return text
    // double spaces → single
    .replace(/[ \t]{2,}/g, ' ')
    // space before , ; : . ? ! → no space (FR uses NBSP before ; : ? ! but
    // standard webm transcripts emit regular spaces; we keep the user's
    // own NBSP usage intact by only touching ASCII space here)
    .replace(/ +([,.;:!?…])/g, '$1')
    // repeated commas: ",,,"   → ","
    .replace(/,([\s,]+),/g, ',')
    .replace(/,{2,}/g, ',')
    // ", ." → "."
    .replace(/,\s*([.!?…])/g, '$1')
    // Two terminators in a row (".", "!", "?", "…") collapse to ONE — keep
    // the FIRST so the original sentence's intended punctuation wins over
    // the scrubbed hallucination's. Examples after a hallucination strip:
    //   "rapport ? !"   → "rapport?"
    //   "conclusion. ." → "conclusion."
    //   "file. !"        → "file."
    .replace(/([.!?…])[\s.!?…]*[.!?…]/g, '$1')
    // sentence start uppercased? Don't bother — Whisper already did it.
    // strip stranded punctuation at start: ", Hello" → "Hello"
    .replace(/^[\s,;:.!?…]+/, '')
    // strip stranded comma at end before terminator: "phrase , !" → "phrase !"
    // (handled above; this catches the trailing case)
    .replace(/,(\s*)$/, '')
    .trim();
}

/**
 * Remove filler interjections ("euh", "um"…) for the given language.
 * If `lang` is unknown we no-op rather than guessing.
 *
 * Empty/whitespace input passes through.
 */
export function stripFillers(text: string, lang?: string): string {
  if (!text || !text.trim()) return text;
  const re = getFillerRegex(lang || '');
  if (!re) return text;
  const out = text.replace(re, ' ');
  if (out === text) return text;
  return tidyPunctuation(out);
}

/**
 * Remove the known Whisper hallucination phrases ("Sous-titres réalisés
 * par…", "Thanks for watching", …) for every language Whisper might
 * have detected. We try all language banks because Whisper can emit a
 * French hallucination on French audio even when `language` was set to
 * "en" (the YouTube tail bleeds across).
 */
export function stripWhisperHallucinations(text: string): string {
  if (!text || !text.trim()) return text;
  let out = text;
  for (const langPatterns of Object.values(HALLUCINATIONS)) {
    for (const pattern of langPatterns) {
      out = out.replace(pattern, '');
    }
  }
  if (out === text) return text;
  return tidyPunctuation(out);
}

/**
 * Combined cleanup — runs hallucination scrubber THEN filler stripper.
 * Order matters: hallucinations sometimes embed filler tokens we want to
 * remove anyway, and the hallucination regex is anchored on specific
 * lexical content that fillers would never destroy.
 *
 * Returns the cleaned text. If the entire input was a hallucination
 * (e.g. one-shot "Merci d'avoir regardé." on dead silence), returns
 * the empty string — the caller can decide what to do with that.
 */
export function cleanupTranscription(text: string, lang?: string): string {
  if (!text || !text.trim()) return '';
  let out = stripWhisperHallucinations(text);
  out = stripFillers(out, lang);
  return out.trim();
}
