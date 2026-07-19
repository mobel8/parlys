// Unit tests for the v1.10.1 hallucination hardenings, run against the
// COMPILED dist/ (the exact bytes the app executes):
//   - PROMPT-ECHO guard: a segment that merely echoes the biasing prompt
//     (verbatim or accent/punctuation-normalized) is dropped.
//   - HARD tail cut: words whose timestamps start > speechEnd+1200 ms are
//     beyond the physical end of the shipped clip and are cut even when
//     the count guard trips (the old code KEPT big fabricated tails).
//   - LOOP-REPEAT collapse: ≥3 consecutive identical short segments keep
//     only the first (cross-segment stuck-decoder loops).
//   - STRICT no-speech bar on clips where the client measured almost no
//     speech (< 600 ms cumulative): no_speech_prob > 0.4 drops.
//   - Regressions: real dictation shapes survive every new rule.
//
// Usage: node scripts/test-hallucination-filter-v2.js   (exit 0 = all pass)

'use strict';
const path = require('path');
const dist = (...p) => require(path.join(__dirname, '..', 'dist', ...p));
const { applySegmentFilter } = dist('main', 'engines', 'whisper.js');

let failures = 0;
let idx = 0;
function check(name, actual, expected) {
  idx++;
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(idx).padStart(2)} ${name}`);
  if (!ok) console.log(`        expected: ${JSON.stringify(expected)}\n        actual:   ${JSON.stringify(actual)}`);
}

const FR_PROMPT = 'Voici une dictée en français avec ponctuation, majuscules et accents corrects.';
const goodSeg = (text, start, end) => ({
  text, start, end, no_speech_prob: 0.02, avg_logprob: -0.2, compression_ratio: 1.1,
});
const meta = (intervals, endMs) => ({
  intervalsMs: intervals, endMs, startMs: intervals.length ? intervals[0][0] : 0,
});

// ------------------------------------------------ PROMPT ECHO
check(
  'prompt echoed verbatim as the only segment → EMPTY',
  applySegmentFilter(
    { text: FR_PROMPT, segments: [goodSeg(' ' + FR_PROMPT, 0.0, 2.0)] },
    meta([[0, 800]], 800),
    FR_PROMPT,
  ),
  '',
);
check(
  'prompt echoed normalized (no accents/punct) → EMPTY',
  applySegmentFilter(
    {
      text: 'voici une dictee en francais avec ponctuation majuscules et accents corrects',
      segments: [goodSeg(' voici une dictee en francais avec ponctuation majuscules et accents corrects', 0.0, 2.0)],
    },
    meta([[0, 800]], 800),
    FR_PROMPT,
  ),
  '',
);
check(
  'partial prompt echo (a contained ≥12-char slice) → EMPTY',
  applySegmentFilter(
    { text: 'ponctuation, majuscules et accents corrects.', segments: [goodSeg(' ponctuation, majuscules et accents corrects.', 0.0, 1.4)] },
    meta([[0, 700]], 700),
    FR_PROMPT,
  ),
  '',
);
check(
  'real dictation UNRELATED to the prompt survives (prompt provided)',
  applySegmentFilter(
    { text: 'Bonjour, envoie le rapport à Marc.', segments: [goodSeg(' Bonjour, envoie le rapport à Marc.', 0.0, 2.2)] },
    meta([[0, 2200]], 2200),
    FR_PROMPT,
  ),
  'Bonjour, envoie le rapport à Marc.',
);
check(
  'short segment ("Oui.") never treated as prompt echo (< 12 chars)',
  applySegmentFilter(
    { text: 'Oui.', segments: [goodSeg(' Oui.', 0.0, 0.5)] },
    meta([[0, 700]], 700),
    FR_PROMPT,
  ),
  'Oui.',
);

// ------------------------------------------------ HARD TAIL CUT
// 5 real words end at 2.0s (client endMs=2000); Whisper appends a
// 16-word fabricated sentence timestamped 4.0→8.0s — beyond the physical
// end of the clip. 16 > MAX_TAIL_WORDS_CUT(12) used to trip the guard and
// keep EVERYTHING; the hard rule now cuts all 16.
{
  const realText = 'Bonjour voici mon vrai message final';
  const fake = 'et n oubliez surtout pas de vous abonner à la chaîne et de mettre un pouce bleu';
  const fakeWords = fake.split(' ');
  const words = [];
  const realWords = realText.split(' ');
  realWords.forEach((w, i) => words.push({ word: w, start: 0.2 + i * 0.3, end: 0.4 + i * 0.3 }));
  fakeWords.forEach((w, i) => words.push({ word: w, start: 4.0 + i * 0.25, end: 4.2 + i * 0.25 }));
  const seg = goodSeg(' ' + realText + ' ' + fake, 0.0, 8.0);
  check(
    'fabricated 16-word tail beyond clip end → hard-cut despite count guard',
    applySegmentFilter(
      { text: realText + ' ' + fake, segments: [seg], words },
      meta([[200, 2000]], 2000),
    ),
    realText,
  );
}
// Soft-band drift protection stays: many trailing words JUST past the soft
// cutoff (but before the hard cutoff) still trip the guard → text kept.
{
  const realText = 'Un deux trois quatre cinq';
  const tail = 'six sept huit neuf dix onze douze treize quatorze quinze seize dix-sept';
  const words = [];
  realText.split(' ').forEach((w, i) => words.push({ word: w, start: 0.2 + i * 0.3, end: 0.4 + i * 0.3 }));
  // tail words start 2.5→3.0s: past soft cutoff (2000+350) but before hard (2000+1200=3.2s)
  tail.split(' ').forEach((w, i) => words.push({ word: w, start: 2.5 + i * 0.04, end: 2.55 + i * 0.04 }));
  const seg = goodSeg(' ' + realText + ' ' + tail, 0.0, 3.0);
  check(
    'soft-band overflow (drift shape) still protected by the guard → kept whole',
    applySegmentFilter(
      { text: realText + ' ' + tail, segments: [seg], words },
      meta([[200, 2000]], 2000),
    ),
    realText + ' ' + tail,
  );
}
// Normal small tail (≤12 words) keeps the historical behaviour.
{
  const realText = 'Envoie le compte rendu ce soir';
  const words = [];
  realText.split(' ').forEach((w, i) => words.push({ word: w, start: 0.2 + i * 0.3, end: 0.4 + i * 0.3 }));
  words.push({ word: 'Merci.', start: 2.9, end: 3.1 });
  const seg = goodSeg(' ' + realText + ' Merci.', 0.0, 3.2);
  check(
    'classic 1-word tail ("Merci.") still cut by the soft rule',
    applySegmentFilter(
      { text: realText + ' Merci.', segments: [seg], words },
      meta([[200, 2200]], 2200),
    ),
    realText,
  );
}

// ------------------------------------------------ LOOP REPEAT
check(
  '5× identical "Merci." segments collapse to one',
  applySegmentFilter(
    {
      text: ' Merci. Merci. Merci. Merci. Merci.',
      segments: [0, 1, 2, 3, 4].map((i) => goodSeg(' Merci.', i * 0.4, i * 0.4 + 0.3)),
    },
    meta([[0, 2000]], 2000),
  ),
  'Merci.',
);
check(
  'two identical segments (legit repetition) are NOT collapsed',
  applySegmentFilter(
    {
      text: ' Oui. Oui.',
      segments: [goodSeg(' Oui.', 0.1, 0.4), goodSeg(' Oui.', 0.6, 0.9)],
    },
    meta([[0, 1200]], 1200),
  ),
  'Oui. Oui.',
);
check(
  'alternating segments are NOT collapsed',
  applySegmentFilter(
    {
      text: ' Un. Deux. Un. Deux.',
      segments: [goodSeg(' Un.', 0.1, 0.3), goodSeg(' Deux.', 0.4, 0.6), goodSeg(' Un.', 0.7, 0.9), goodSeg(' Deux.', 1.0, 1.2)],
    },
    meta([[0, 1400]], 1400),
  ),
  'Un. Deux. Un. Deux.',
);

// ------------------------------------------------ STRICT NO-SPEECH (short clips)
check(
  'breath blip (client speech 300ms) + no_speech 0.55 → dropped (strict bar)',
  applySegmentFilter(
    { text: 'Au revoir.', segments: [{ text: ' Au revoir.', start: 0.0, end: 0.6, no_speech_prob: 0.55, avg_logprob: -0.5, compression_ratio: 1.0 }] },
    meta([[100, 400]], 400),
  ),
  '',
);
check(
  'real micro-utterance (300ms, confident no_speech 0.05) survives strict bar',
  applySegmentFilter(
    { text: 'OK.', segments: [{ text: ' OK.', start: 0.0, end: 0.4, no_speech_prob: 0.05, avg_logprob: -0.2, compression_ratio: 0.9 }] },
    meta([[100, 400]], 400),
  ),
  'OK.',
);
check(
  'normal-length clip keeps the historical 0.7 bar (0.55 passes)',
  applySegmentFilter(
    { text: 'Voici la longue phrase dictée normalement.', segments: [{ text: ' Voici la longue phrase dictée normalement.', start: 0.0, end: 2.5, no_speech_prob: 0.55, avg_logprob: -0.4, compression_ratio: 1.2 }] },
    meta([[100, 2600]], 2600),
  ),
  'Voici la longue phrase dictée normalement.',
);

// ------------------------------------------------ CR CORROBORATION (v1.10.5)
// compression_ratio alone must not delete CONFIDENT speech: legitimate
// repetitive dictation (numbered lists) measured live at cr=4.43 with
// no_speech=0.000 / logprob=-0.31 — kept now.
check(
  'high cr but confident speech (real repetitive dictation) → KEPT',
  applySegmentFilter(
    { text: 'Un. Deux. Trois. Quatre.', segments: [{ text: ' Un. Deux. Trois. Quatre.', start: 0.0, end: 17.6, no_speech_prob: 0.0, avg_logprob: -0.31, compression_ratio: 4.43 }] },
    meta([[100, 17000]], 17000),
  ),
  'Un. Deux. Trois. Quatre.',
);
check(
  'high cr with DEGRADED confidence (true decoder loop) → dropped',
  applySegmentFilter(
    { text: 'la la la la', segments: [{ text: ' la la la la', start: 0.0, end: 4.0, no_speech_prob: 0.35, avg_logprob: -0.9, compression_ratio: 3.2 }] },
    meta([[100, 3800]], 3800),
  ),
  '',
);
check(
  'high cr with missing confidence fields → dropped (conservative, unchanged)',
  applySegmentFilter(
    { text: 'boucle boucle boucle', segments: [{ text: ' boucle boucle boucle', start: 0.0, end: 3.0, compression_ratio: 3.5 }] },
    meta([[100, 2800]], 2800),
  ),
  '',
);

console.log(failures === 0 ? `\nALL ${idx} PASS` : `\n${failures}/${idx} FAILED`);
process.exit(failures ? 1 : 0);
