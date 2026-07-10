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
