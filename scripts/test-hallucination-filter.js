// Unit tests for the server-side hallucination defenses, run against the
// COMPILED dist/ (the exact bytes the app executes):
//   - applySegmentFilter (dist/main/engines/whisper.js): verbose_json
//     confidence filter, now FAIL-CLOSED when every segment is flagged.
//   - cleanupTranscription (dist/main/services/text-cleanup.js): regex
//     scrubber regression — known hallucinations die, real "merci" lives.
//
// Usage: node scripts/test-hallucination-filter.js   (exit 0 = all pass)

'use strict';
const path = require('path');
const dist = (...p) => require(path.join(__dirname, '..', 'dist', ...p));
const { applySegmentFilter } = dist('main', 'engines', 'whisper.js');
const { cleanupTranscription } = dist('main', 'services', 'text-cleanup.js');

let failures = 0;
let idx = 0;
function check(name, actual, expected) {
  idx++;
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(idx).padStart(2)} ${name}`);
  if (!ok) console.log(`        expected: ${JSON.stringify(expected)}\n        actual:   ${JSON.stringify(actual)}`);
}

// ------------------------------------------------ applySegmentFilter
// THE fix: silence-only clip → Groq flags its lone hallucinated segment as
// no-speech → we must return EMPTY, not the hallucinated fallback text.
check(
  'all segments low-confidence (silence → "Merci.") → EMPTY',
  applySegmentFilter({
    text: 'Merci.',
    segments: [{ text: ' Merci.', no_speech_prob: 0.93, avg_logprob: -0.4, compression_ratio: 0.8 }],
  }),
  '',
);
check(
  'all segments flagged via logprob → EMPTY',
  applySegmentFilter({
    text: 'Sous-titres réalisés para la communauté',
    segments: [
      { text: 'Sous-titres réalisés', no_speech_prob: 0.2, avg_logprob: -1.8 },
      { text: ' para la communauté', no_speech_prob: 0.3, avg_logprob: -1.5 },
    ],
  }),
  '',
);
// Mixed: hallucinated tail dropped, real speech kept.
check(
  'mixed segments → keeps only confident text',
  applySegmentFilter({
    text: "Bonjour à tous. Merci d'avoir regardé.",
    segments: [
      { text: 'Bonjour à tous.', no_speech_prob: 0.02, avg_logprob: -0.25, compression_ratio: 1.3 },
      { text: " Merci d'avoir regardé.", no_speech_prob: 0.88, avg_logprob: -0.9, compression_ratio: 1.1 },
    ],
  }),
  'Bonjour à tous.',
);
// Fail-open cases that MUST stay fail-open:
check(
  'no segments array → fallback full text',
  applySegmentFilter({ text: 'Texte sans segments.' }),
  'Texte sans segments.',
);
check(
  'segments without confidence fields → kept (missing ≠ bad)',
  applySegmentFilter({
    text: 'Un texte normal.',
    segments: [{ text: 'Un texte normal.' }],
  }),
  'Un texte normal.',
);
check(
  'healthy segments → joined text',
  applySegmentFilter({
    text: 'Première phrase. Deuxième phrase.',
    segments: [
      { text: 'Première phrase.', no_speech_prob: 0.01, avg_logprob: -0.2, compression_ratio: 1.2 },
      { text: ' Deuxième phrase.', no_speech_prob: 0.02, avg_logprob: -0.3, compression_ratio: 1.4 },
    ],
  }),
  'Première phrase. Deuxième phrase.',
);

// ------------------------------------------------ v1.9: timestamp cross-check
// Client speech geometry (speech-gate) vs Whisper segment/word timestamps.
// meta times are ms relative to the shipped clip.

// TAIL-SEGMENT rule: a segment starting way after the client's measured end
// of speech is invented (the clip physically ends ~320 ms after endMs).
check(
  'meta: segment starting after speech end → dropped',
  applySegmentFilter({
    text: 'Voici mon rapport. Merci de votre attention.',
    segments: [
      { start: 0.2, end: 2.1, text: 'Voici mon rapport.', no_speech_prob: 0.01, avg_logprob: -0.2 },
      { start: 3.0, end: 4.2, text: ' Merci de votre attention.', no_speech_prob: 0.32, avg_logprob: -0.5 },
    ],
  }, { intervalsMs: [[200, 2050]], endMs: 2050, startMs: 200 }),
  'Voici mon rapport.',
);

// GAP rule: a segment entirely inside a client-measured mid-clip silence.
check(
  'meta: segment inside client silence gap → dropped',
  applySegmentFilter({
    text: 'Premier point. Abonnez-vous. Deuxième point.',
    segments: [
      { start: 0.1, end: 1.6, text: 'Premier point.', no_speech_prob: 0.02, avg_logprob: -0.2 },
      { start: 3.1, end: 4.0, text: ' Abonnez-vous.', no_speech_prob: 0.4, avg_logprob: -0.6 },
      { start: 5.6, end: 7.2, text: ' Deuxième point.', no_speech_prob: 0.03, avg_logprob: -0.25 },
    ],
  }, { intervalsMs: [[100, 1650], [5580, 7150]], endMs: 7150, startMs: 100 }),
  'Premier point. Deuxième point.',
);

// Slop guard: a segment only slightly past the measured end (word decay,
// timestamp jitter) must SURVIVE.
check(
  'meta: segment within the ±450ms slop → kept',
  applySegmentFilter({
    text: 'Bonjour. À demain.',
    segments: [
      { start: 0.1, end: 1.4, text: 'Bonjour.', no_speech_prob: 0.02, avg_logprob: -0.2 },
      { start: 1.75, end: 2.4, text: ' À demain.', no_speech_prob: 0.05, avg_logprob: -0.3 },
    ],
  }, { intervalsMs: [[100, 2100]], endMs: 2100, startMs: 100 }),
  'Bonjour. À demain.',
);

// WORD tail-cut: invented words appended to the FINAL (valid) segment.
check(
  'meta+words: invented tail words inside the last segment → cut',
  applySegmentFilter({
    text: 'Voilà le résumé du projet et merci à tous',
    segments: [
      { start: 0.0, end: 5.9, text: 'Voilà le résumé du projet et merci à tous', no_speech_prob: 0.05, avg_logprob: -0.35 },
    ],
    words: [
      { word: 'Voilà', start: 0.3, end: 0.6 },
      { word: 'le', start: 0.6, end: 0.7 },
      { word: 'résumé', start: 0.7, end: 1.1 },
      { word: 'du', start: 1.1, end: 1.2 },
      { word: 'projet', start: 1.2, end: 1.7 },
      { word: 'et', start: 3.4, end: 3.6 },
      { word: 'merci', start: 3.6, end: 4.1 },
      { word: 'à', start: 4.1, end: 4.2 },
      { word: 'tous', start: 4.2, end: 4.6 },
    ],
  }, { intervalsMs: [[300, 1750]], endMs: 1750, startMs: 300 }),
  'Voilà le résumé du projet',
);

// Tail-cut guard vs HARD cutoff — CONTRACT UPDATED in v1.10.1.
// The client TRIMS the clip at speechEnd+~320 ms, so NO real word can be
// stamped > speechEnd+1200 ms: those samples don't exist in the shipped
// file, "drift" or not. Words past the HARD cutoff are now cut even when
// the proportion guard trips ("trois/quatre/cinq" claim 2.2-3.5 s in a
// ~1.2 s clip → fiction). Genuine drift protection lives in the SOFT band
// (see test-hallucination-filter-v2.js "soft-band overflow").
check(
  'meta+words: tail beyond the PHYSICAL clip end → hard-cut despite guard',
  applySegmentFilter({
    text: 'Un deux trois quatre cinq',
    segments: [
      { start: 0.0, end: 4.0, text: 'Un deux trois quatre cinq', no_speech_prob: 0.05, avg_logprob: -0.3 },
    ],
    words: [
      { word: 'Un', start: 0.2, end: 0.4 },
      { word: 'deux', start: 1.2, end: 1.4 },
      { word: 'trois', start: 2.2, end: 2.4 },
      { word: 'quatre', start: 2.9, end: 3.1 },
      { word: 'cinq', start: 3.5, end: 3.7 },
    ],
  }, { intervalsMs: [[200, 900]], endMs: 900, startMs: 200 }),
  'Un deux',
);

// COMBO confidence rule: moderately-unsure on BOTH axes = hallucination zone.
check(
  'combo rule: no_speech 0.6 + logprob -1.0 → dropped',
  applySegmentFilter({
    text: 'Bonjour. et la suite bizarre',
    segments: [
      { text: 'Bonjour.', no_speech_prob: 0.02, avg_logprob: -0.2 },
      { text: ' et la suite bizarre', no_speech_prob: 0.6, avg_logprob: -1.0 },
    ],
  }),
  'Bonjour.',
);
check(
  'combo rule boundary: no_speech 0.6 + logprob -0.5 (confident tokens) → kept',
  applySegmentFilter({
    text: 'Oui. Non.',
    segments: [
      { text: 'Oui.', no_speech_prob: 0.6, avg_logprob: -0.5 },
      { text: ' Non.', no_speech_prob: 0.4, avg_logprob: -0.9 },
    ],
  }),
  'Oui. Non.',
);

// meta ABSENT (interpreter/listener paths) → timestamp rules disengaged,
// historical behaviour preserved even with word data present.
check(
  'no meta → no timestamp rule, text intact',
  applySegmentFilter({
    text: 'Salut tout le monde',
    segments: [{ start: 9.0, end: 10.0, text: 'Salut tout le monde', no_speech_prob: 0.05, avg_logprob: -0.3 }],
    words: [{ word: 'Salut', start: 9.0, end: 9.3 }],
  }),
  'Salut tout le monde',
);

// ------------------------------------------------ cleanupTranscription
check(
  'pure YouTube outro → EMPTY',
  cleanupTranscription("Merci d'avoir regardé cette vidéo.", 'fr'),
  '',
);
check(
  'Amara subtitle credit stripped, real sentence kept',
  cleanupTranscription("Bonjour tout le monde. Sous-titres réalisés par la communauté d'Amara.org", 'fr'),
  'Bonjour tout le monde.',
);
check(
  'legitimate "merci" is NEVER scrubbed',
  cleanupTranscription('Je te remercie, merci beaucoup Paul.', 'fr'),
  'Je te remercie, merci beaucoup Paul.',
);
check(
  'trailing bare-dots artefact → EMPTY',
  cleanupTranscription('...', 'fr'),
  '',
);
check(
  'fillers stripped in raw mode',
  cleanupTranscription('euh donc voilà le rapport euh final', 'fr'),
  'donc voilà le rapport final',
);

console.log(failures === 0 ? '\nALL HALLUCINATION-FILTER TESTS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
