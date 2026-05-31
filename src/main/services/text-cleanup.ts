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
 * TWO TIERS (see `stripWhisperHallucinations` for why):
 *
 *  - HALLUCINATIONS_SAFE — highly distinctive LITERAL multi-word phrases
 *    (and bare-terminator artefacts) that essentially never occur in real
 *    dictation. These run on ALL text REGARDLESS of detected language,
 *    because Whisper can emit a French outro on English audio (the trained
 *    YouTube tail bleeds across languages). Cross-language scrubbing of
 *    these specific literals is INTENTIONAL and must be preserved.
 *
 *  - HALLUCINATIONS_BROAD — patterns anchored on bare common words with
 *    open tails ("subscribe", "see you soon", "à bientôt", "bye"). A naive
 *    cross-language sweep here destroyed ordinary dictation ("please
 *    subscribe to the newsletter and confirm" → ""). These only run when
 *    their bank matches the DETECTED language, and the riskiest ones have
 *    been rewritten to require unmistakable YouTube-CTA framing so a lone
 *    "subscribe"/"like" in a normal clause survives.
 */
const HALLUCINATIONS_SAFE: Record<string, RegExp[]> = {
  fr: [
    // Amara / community subtitles — distinctive literal phrases.
    /\bsous[-\s]?titres?\s+(?:réalisés?|fait[s]?)\s+par\s+la\s+communauté\s+d['']?amara\.?org\.?/gi,
    // Same Amara tail but with looser ".org" spelling ("amara org"); bound
    // the tail to the FIRST sentence terminator so it can NEVER swallow a
    // following legitimate sentence (was `[\s\S]*?$`, which deleted to the
    // end of the string and destroyed trailing content).
    /\bsous[-\s]?titres?\s+(?:réalisés?|fait[s]?)\s+par\s+(?:la\s+)?communauté\s+d['']?amara[^.!?…]*[.!?…]?/gi,
    /\bsous[-\s]?titrage\s+(?:mfp|société\s+radio[-\s]?canada|st['\s]?501)\b[^.!?\n]*[.!?…]?/gi,
    /\b❤️?\s*par\s+sous[-\s]?titres?\s+amara\.?org\b/gi,
    /\bsous[-\s]?titres?\s+effectués\s+par[^.!?\n]*[.!?…]?/gi,
    // YouTube outros — distinctive literal phrases.
    /\bmerci\s+d['']?avoir\s+regardé[^.!?\n]*[.!?…]?/gi,
    /\bn['']?(?:hésitez|hesitez)\s+pas\s+à\s+(?:vous\s+)?(?:abonner|liker)[^.!?\n]*[.!?…]?/gi,
    /\babonnez[-\s]?vous(?:\s+à\s+(?:ma|notre)\s+chaî?ne)?[^.!?\n]*[.!?…]?/gi,
    /\blike(?:r|z)?\s+et\s+abonnez[-\s]?vous\b[^.!?\n]*[.!?…]?/gi,
  ],
  en: [
    /\bthanks?\s+(?:so\s+much\s+)?for\s+watching[^.!?\n]*[.!?…]?/gi,
    /\bthank\s+you\s+(?:so\s+much\s+)?for\s+watching[^.!?\n]*[.!?…]?/gi,
    // Standalone "subscribe to my/our/the channel" is specific enough to
    // keep as a cross-language literal.
    /\bsubscribe\s+to\s+(?:my|our|the)\s+channel[^.!?\n]*[.!?…]?/gi,
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
  // Language-agnostic dangling artefacts (whole string is one stray mark).
  // These are safe everywhere — there is no legitimate dictation that is
  // ONLY "..." / "." / "?" / ".5".
  _any: [
    /^\s*\.\.\.\s*$/g,
    /^\s*\.\s*$/g,
    /^\s*\?\s*$/g,
    /^\s*\.5\s*$/g,
  ],
};

/**
 * BROAD / RISKY patterns — only applied when their bank matches the
 * DETECTED language. See the tier comment above.
 */
const HALLUCINATIONS_BROAD: Record<string, RegExp[]> = {
  fr: [
    // End-anchored sign-offs that CAN be legitimate French dictation
    // ("à bientôt" / "à la prochaine"); only strip when audio is French.
    /\bà\s+la\s+prochaine\s*!?$/gi,
    /\bà\s+bientôt\s*!?$/gi,
  ],
  en: [
    // YouTube "like/subscribe" CTA. REWRITTEN so a bare "subscribe"/"like"
    // in a normal clause is NOT consumed (the old open-tailed `(?:like|
    // subscribe)[^.!?\n]*` ate "please subscribe to the newsletter and
    // confirm" → "", "I like the new design…" → "I ", etc.). We now require
    // the unmistakable PAIRED CTA "like and subscribe" / "subscribe and
    // like" (optionally with a "don't forget to" / "please" / "make sure to"
    // lead-in). A LONE "please subscribe"/"like X" is ambiguous real
    // dictation and is left alone; the genuine channel-pitch outro is still
    // caught by the SAFE "subscribe to my/our/the channel" literal.
    /\b(?:don['']?t\s+forget\s+to\s+|please\s+|make\s+sure\s+to\s+)?(?:like\s+(?:and|&)\s+subscribe|subscribe\s+(?:and|&)\s+like)[^.!?\n]*[.!?…]?/gi,
    // End-anchored sign-offs. The "see you …" tail is bounded to a short
    // closer ("everyone"/"guys"/"all"/"folks") + terminator and ANCHORED at
    // end of string, so "I'll see you soon at the office tomorrow" survives
    // (an open `[^.!?\n]*` tail would have eaten the rest of the clause).
    /\bsee\s+you\s+(?:next\s+time|in\s+the\s+next\s+video|soon)(?:\s+(?:everyone|guys|all|folks))?\s*[.!?…]*$/gi,
    /\b(?:peace|bye)\s*!?$/gi,
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
 * par…", "Thanks for watching", …).
 *
 * Two tiers (see HALLUCINATIONS_SAFE / HALLUCINATIONS_BROAD):
 *  - SAFE banks run for EVERY language, regardless of `lang`. These are
 *    distinctive literal phrases that bleed across languages (Whisper can
 *    emit a French outro on English audio), so cross-language scrubbing is
 *    intentional and preserved.
 *  - BROAD banks (bare common words / open tails) run ONLY when their bank
 *    matches the DETECTED `lang`, so an English-only "like/subscribe" CTA
 *    pattern can't shred ordinary French/Spanish dictation and vice-versa.
 *    If `lang` is unknown, BROAD banks are skipped entirely (conservative).
 */
export function stripWhisperHallucinations(text: string, lang?: string): string {
  if (!text || !text.trim()) return text;
  let out = text;
  // Tier 1 — SAFE literals + language-agnostic artefacts: run on ALL text.
  for (const langPatterns of Object.values(HALLUCINATIONS_SAFE)) {
    for (const pattern of langPatterns) {
      out = out.replace(pattern, '');
    }
  }
  // Tier 2 — BROAD/RISKY: only the bank for the detected language.
  const code = (lang || '').toLowerCase().slice(0, 2);
  const broad = HALLUCINATIONS_BROAD[code];
  if (broad) {
    for (const pattern of broad) {
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
  let out = stripWhisperHallucinations(text, lang);
  out = stripFillers(out, lang);
  return out.trim();
}
