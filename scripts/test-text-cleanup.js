// Ad-hoc sanity test for text-cleanup.ts compiled output.
// Run with:   node scripts/test-text-cleanup.js
const { cleanupTranscription, stripFillers, stripWhisperHallucinations } = require('../dist/main/services/text-cleanup');

const CASES = [
  // ─── French fillers ──────────────────────────────────────────────
  {
    label: 'FR: euh standalone',
    input: "Je pense que, euh, on devrait partir maintenant.",
    lang: 'fr',
    expectContains: 'Je pense',
    expectMissing: 'euh',
  },
  {
    label: 'FR: heu repeated',
    input: "heu heu heu attends, je réfléchis.",
    lang: 'fr',
    expectContains: 'attends',
    expectMissing: 'heu',
  },
  {
    label: 'FR: hum mid-sentence',
    input: "C'est hum compliqué à expliquer.",
    lang: 'fr',
    expectContains: "compliqué",
    expectMissing: 'hum',
  },
  {
    label: 'FR: heureux NOT stripped (false-positive guard)',
    input: "Je suis heureux de te voir.",
    lang: 'fr',
    expectContains: 'heureux',
    expectMissing: null,
  },
  {
    label: 'FR: Benjamin NOT stripped (Ben is proper-noun-safe)',
    input: "Benjamin a dit oui.",
    lang: 'fr',
    expectContains: 'Benjamin',
    expectMissing: null,
  },
  // ─── English fillers ─────────────────────────────────────────────
  {
    label: 'EN: um/uh',
    input: "I think, um, we should, uh, leave now.",
    lang: 'en',
    expectContains: 'we should',
    expectMissing: 'um',
  },
  {
    label: 'EN: umbrella NOT stripped',
    input: "Bring an umbrella, it might rain.",
    lang: 'en',
    expectContains: 'umbrella',
    expectMissing: null,
  },
  // ─── French hallucinations ───────────────────────────────────────
  {
    label: 'FR: Sous-titres Amara',
    input: "Donc on se voit demain. Sous-titres réalisés par la communauté d'Amara.org",
    lang: 'fr',
    expectContains: 'demain',
    expectMissing: 'Amara',
  },
  {
    label: 'FR: Merci d\'avoir regardé',
    input: "Tu peux m'envoyer le rapport ? Merci d'avoir regardé cette vidéo, n'hésitez pas à vous abonner !",
    lang: 'fr',
    expectContains: 'rapport',
    expectMissing: "d'avoir regardé",
  },
  {
    label: 'FR: Sous-titrage MFP',
    input: "Donc voilà la conclusion. Sous-titrage MFP.",
    lang: 'fr',
    expectContains: 'conclusion',
    expectMissing: 'MFP',
  },
  {
    label: 'FR: Standalone "Merci" NOT stripped (real word)',
    input: "Merci beaucoup pour ton aide.",
    lang: 'fr',
    expectContains: 'Merci beaucoup',
    expectMissing: null,
  },
  // ─── English hallucinations ──────────────────────────────────────
  {
    label: 'EN: Thanks for watching',
    input: "OK send me the file. Thanks for watching everyone, subscribe!",
    lang: 'en',
    expectContains: 'send me',
    expectMissing: 'Thanks for watching',
  },
  // ─── Combined ────────────────────────────────────────────────────
  {
    label: 'FR combo: fillers + hallucination',
    input: "Donc, euh, je pense que, hum, on peut partir. Merci d'avoir regardé !",
    lang: 'fr',
    expectContains: 'on peut partir',
    expectMissing: 'euh',
  },
  // ─── Edge cases ──────────────────────────────────────────────────
  {
    label: 'Empty in → empty out',
    input: "",
    lang: 'fr',
    expect: '',
  },
  {
    label: 'Only hallucination → empty string',
    input: "Sous-titres réalisés par la communauté d'Amara.org",
    lang: 'fr',
    expect: '',
  },
  {
    label: 'Unknown lang → no filler strip',
    input: "Je suis, euh, là.",
    lang: 'jp',
    expectContains: 'euh',
  },
  // ─── v1.9: FR trailing-hallucination bank additions ───────────────
  {
    label: "FR: merci d'avoir écouté stripped",
    input: "Voici le compte rendu. Merci d'avoir écouté !",
    lang: 'fr',
    expect: 'Voici le compte rendu.',
  },
  {
    label: "FR: n'oubliez pas de vous abonner stripped",
    input: "Le rapport est prêt. N'oubliez pas de vous abonner à la chaîne.",
    lang: 'fr',
    expect: 'Le rapport est prêt.',
  },
  {
    label: 'FR: à la prochaine (fois) end-anchored stripped (accent-boundary fix)',
    input: "On se voit demain, à la prochaine fois !",
    lang: 'fr',
    expect: 'On se voit demain',
  },
  {
    label: 'FR: à bientôt end-anchored stripped (accent-boundary fix)',
    input: "On se retrouve lundi. À bientôt !",
    lang: 'fr',
    expect: 'On se retrouve lundi.',
  },
  {
    label: 'FR: "la prochaine" mid-sentence NOT stripped',
    input: "La prochaine réunion est jeudi.",
    lang: 'fr',
    expect: 'La prochaine réunion est jeudi.',
  },
  {
    label: 'FR: "écouter" as verb NOT stripped',
    input: "Je vais écouter le podcast demain.",
    lang: 'fr',
    expect: 'Je vais écouter le podcast demain.',
  },
];

let pass = 0, fail = 0;
for (const c of CASES) {
  const out = cleanupTranscription(c.input, c.lang);
  let ok = true;
  let why = '';
  if ('expect' in c) {
    if (out !== c.expect) { ok = false; why = `expected exact "${c.expect}"`; }
  }
  if (ok && c.expectContains && !out.includes(c.expectContains)) {
    ok = false; why = `missing required substring "${c.expectContains}"`;
  }
  if (ok && c.expectMissing && out.toLowerCase().includes(c.expectMissing.toLowerCase())) {
    ok = false; why = `unwanted substring "${c.expectMissing}" still present`;
  }
  const mark = ok ? '✓ PASS' : '✗ FAIL';
  console.log(`${mark}  ${c.label}`);
  console.log(`        in : ${JSON.stringify(c.input)}`);
  console.log(`        out: ${JSON.stringify(out)}`);
  if (!ok) console.log(`        why: ${why}`);
  if (ok) pass++; else fail++;
}
console.log(`\n${pass}/${pass + fail} passed (${fail} fail)`);
process.exit(fail ? 1 : 0);
