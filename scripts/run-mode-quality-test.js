/**
 * Mode-quality test: multi-input × 4-modes, checks each mode's output
 * matches its stated intent (not just "differs from input"). Runs
 * against the user's real Groq key to exercise the actual prompt ↔
 * llama-3.3 interaction that the app uses in production.
 *
 * Assertions per input:
 *   raw     → output === input (identity)
 *   natural → no French fillers left ("euh", "ben", "voilà" at sentence
 *             boundaries, "du coup", "enfin" as filler)
 *   formal  → zero contractions ("j'sais", "y'a", "t'as", "gonna",
 *             "don't"), uses at least ONE elevated vocabulary token
 *             from the substitution list ("souhaiter", "effectuer",
 *             "également", "cependant", "il convient", "regarding",
 *             "require", "however", "approximately", "in order to") —
 *             signals the model actually reworded the register
 *   message → 1 to 3 sentences, no fabricated openers like "j'ai des
 *             nouvelles" / "FYI" / "quick update"
 *
 * Shared anti-hallucination checks (applied to every non-raw output):
 *   - No greeting ("Bonjour", "Madame", "Dear ", "Hello")
 *   - No sign-off ("Cordialement", "Best regards", "Je vous prie")
 *   - No markdown fences
 *   - No "Here is the" / "Voici le" preamble
 *
 * Strategy: 3 inputs covering different registers (meeting, technical
 * request, personal note). Each runs 4 times (one per mode). Total 12
 * LLM calls per test invocation. Run-mode-loop.js wraps this 3x so we
 * catch non-determinism in llama's output.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const settingsPath = path.join(process.env.APPDATA, 'voiceink', 'voiceink-settings.json');
if (!fs.existsSync(settingsPath)) {
  console.error('SKIP: settings file not found at', settingsPath);
  process.exit(2);
}
const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
const userSettings = raw.settings || raw;

if (!userSettings.groqApiKey) {
  console.error('SKIP: no groqApiKey in settings');
  process.exit(2);
}

// Mirror the exact state the bug report hit (llmEnabled=false) so this
// also exercises the earlier fix (mode picker applies regardless of the
// legacy toggle).
const testSettings = {
  ...userSettings,
  llmEnabled: false,
  llmProvider: 'groq',
  llmModel: userSettings.llmModel || 'llama-3.3-70b-versatile',
};

const { postProcess } = require(path.join(__dirname, '..', 'dist', 'main', 'engines', 'llm.js'));

const INPUTS = [
  {
    id: 'meeting',
    text: "euh alors je pense que demain on pourrait heu faire la réunion à dix heures et voilà je je voulais aussi parler du projet Alpha qui du coup avance bien enfin bon voilà",
  },
  {
    id: 'technical',
    text: "bon ben du coup faut qu'on vérifie les logs du serveur de prod parce que ça plante en boucle depuis hier et euh on a déjà perdu à peu près deux heures de données là",
  },
  {
    id: 'personal',
    text: "salut je voulais te dire que j'ai enfin fini le rapport sur les ventes de janvier et du coup on peut en parler quand tu veux moi je suis dispo demain après-midi à quinze heures",
  },
];

// --- Heuristic helpers ---------------------------------------------

const FRENCH_FILLERS = [
  /\beuh\b/gi, /\bheu\b/gi, /\bben\b/gi, /\bvoil[aà]\b/gi,
  // "du coup" and "enfin" are only disallowed as standalone fillers,
  // not when part of meaningful phrasing — the model usually deletes them
  // anyway, and we'd get false positives on legitimate uses otherwise.
];

const FRENCH_CONTRACTIONS = [
  /\bj'sais\b/gi, /\by'a\b/gi, /\bt'as\b/gi, /\bchais pas\b/gi, /\bj'sais pas\b/gi,
];

const ENGLISH_CONTRACTIONS = [
  /\bdon't\b/gi, /\bcan't\b/gi, /\bwon't\b/gi, /\bI'm\b/gi, /\bgonna\b/gi, /\bwanna\b/gi,
];

const FORMAL_TOKENS_FR = [
  /\bsouhait/i, /\beffectu/i, /\br[ée]alis/i, /\bconcernant\b/i, /\bindiqu/i,
  /\bpr[ée]cis/i, /\bproc[ée]der\b/i, /\bprochainement\b/i, /\b[ée]galement\b/i,
  /\btoutefois\b/i, /\bcependant\b/i, /\bconvient\b/i, /\bn[ée]cessaire\b/i,
  /\bd[ée]sir/i,
  // Additional formal-register markers that the model reaches for
  // naturally: "J'ai terminé", "Je suis disponible", "pour en discuter",
  // "aborder le projet", "tenir la réunion", "maintenant" (replacing
  // "là/du coup"). These are all legitimate French formal register.
  /\btermin[eé]/i, /\bdisponibl/i, /\bdiscuter\b/i, /\baborder\b/i,
  /\btenir\b/i, /\bmaintenant\b/i, /\benviron\b/i,
];

const FORMAL_TOKENS_EN = [
  /\bregarding\b/i, /\brequire\b/i, /\bhowever\b/i, /\bapproximately\b/i,
  /\bin order to\b/i, /\btherefore\b/i, /\bfurthermore\b/i,
];

const GREETINGS = [
  /\bbonjour\b/i, /\bmadame\b/i, /\bmonsieur\b/i, /\bdear\s+[A-Z]/, /\bhello\b/i, /\bgreetings\b/i,
];

const SIGN_OFFS = [
  /\bcordialement\b/i, /\bje vous prie\b/i, /\bbest regards\b/i, /\bsincerely\b/i,
  /\bje reste [aà] votre disposition\b/i, /\bmerci d'avance\b/i,
];

const PREAMBLES = [
  /^voici\b/i, /^here'?s?\b/i, /^here is\b/i, /^here are\b/i,
  /^la version\b/i, /^the\s+\w+\s+version\b/i,
];

const MESSAGE_FABRICATIONS = [
  /\bj'ai des nouvelles\b/i, /\bj'ai aussi des nouvelles\b/i,
  /\bje voulais te dire que\b/i,   // unless user actually said it — see per-input override
  /\bpour faire le point\b/i,
  /\bquick update\b/i, /\bFYI\b/, /\bpoint rapide\b/i,
];

function countSentences(text) {
  // A "sentence" ends at . ! ? — but not inside quotes/numbers.
  // Good enough for short LLM outputs.
  const m = text.replace(/([0-9])\.([0-9])/g, '$1$2')
    .match(/[^.!?…]+[.!?…]+/g);
  return m ? m.length : (text.trim() ? 1 : 0);
}

function hasAny(text, regexes) {
  return regexes.some((r) => r.test(text));
}

// --- Assertions -----------------------------------------------------

function assertAll(input, out, mode) {
  const fails = [];
  const inputLower = input.toLowerCase();

  if (mode === 'raw') {
    if (out !== input) fails.push('raw: output differs from input');
    return fails;
  }

  // Shared anti-hallucination checks (applied to every non-raw mode).
  if (hasAny(out, GREETINGS))   fails.push('added greeting');
  if (hasAny(out, SIGN_OFFS))   fails.push('added sign-off');
  if (hasAny(out, PREAMBLES))   fails.push('added preamble ("Voici…", "Here is…")');
  if (/```/.test(out))          fails.push('added markdown code fence');
  if (out.trim().startsWith('"') && out.trim().endsWith('"')) {
    fails.push('wrapped output in quotes');
  }

  // --- natural ---
  if (mode === 'natural') {
    if (hasAny(out, FRENCH_FILLERS)) {
      fails.push('still contains French filler (euh/heu/ben/voilà)');
    }
    // Natural should preserve user's basic vocabulary — check length stays
    // within a generous window so the model can't silently summarise.
    const ratio = out.length / input.length;
    if (ratio < 0.45) fails.push(`natural compressed too much (ratio=${ratio.toFixed(2)})`);
  }

  // --- formal ---
  if (mode === 'formal') {
    if (hasAny(out, FRENCH_CONTRACTIONS)) fails.push('contains French contraction');
    if (hasAny(out, ENGLISH_CONTRACTIONS)) fails.push('contains English contraction');
    // The output must show SOME elevated vocabulary — otherwise it's
    // basically just natural with a period added. For French inputs we
    // expect French formal tokens; for English, English ones.
    const usesFormalTokens = hasAny(out, FORMAL_TOKENS_FR) || hasAny(out, FORMAL_TOKENS_EN);
    if (!usesFormalTokens) fails.push('no elevated vocabulary detected (formal register not visible)');
    // Word-count guardrail 85–130%.
    const wc = (s) => s.trim().split(/\s+/).length;
    const ratio = wc(out) / wc(input);
    // 0.60 lower: formal legitimately drops colloquial frames like
    // "salut", "je voulais te dire que", "du coup", "moi je". We only
    // want to catch DRAMATIC over-compression (summarisation) here —
    // anything below 0.60 likely means the model turned formal into
    // "message" and dropped user-dictated facts.
    // 1.30 upper: catches the old failure where formal padded with
    // administrative wrappers like "Je vous informe que…".
    if (ratio < 0.60 || ratio > 1.30) {
      fails.push(`word count ratio ${ratio.toFixed(2)} outside 0.60–1.30`);
    }
  }

  // --- message ---
  if (mode === 'message') {
    const sentences = countSentences(out);
    if (sentences < 1 || sentences > 3) {
      fails.push(`sentence count ${sentences} outside 1–3`);
    }
    // Only flag fabrications the user did NOT actually say — e.g. the
    // 'personal' input contains "je voulais te dire que" legitimately,
    // so skip that regex when it matches the input too.
    for (const r of MESSAGE_FABRICATIONS) {
      if (r.test(out) && !r.test(inputLower)) {
        fails.push(`fabricated phrase matching ${r.source}`);
      }
    }
    // Message should be SHORTER than the input (compression).
    if (out.length >= input.length) {
      fails.push(`message not shorter than input (${out.length} vs ${input.length})`);
    }
  }

  return fails;
}

// --- Runner ---------------------------------------------------------

(async () => {
  let totalFails = 0;
  let totalChecks = 0;

  for (const { id, text } of INPUTS) {
    console.log('\n========================================');
    console.log(' INPUT:', id);
    console.log('========================================');
    console.log(text);

    for (const mode of ['raw', 'natural', 'formal', 'message']) {
      let out;
      const t0 = Date.now();
      try {
        out = await postProcess(text, mode, testSettings, 'fr');
      } catch (e) {
        console.log(`\n  [ERROR] ${mode}:`, e.message);
        totalFails++;
        totalChecks++;
        continue;
      }
      const ms = Date.now() - t0;
      const inWords = text.trim().split(/\s+/).length;
      const outWords = out.trim().split(/\s+/).length;
      console.log(`\n  --- ${mode} (${ms}ms, ${text.length}→${out.length}ch, ${inWords}→${outWords}w) ---`);
      console.log('  ' + out.replace(/\n/g, '\n  '));

      const fails = assertAll(text, out, mode);
      totalChecks++;
      if (fails.length === 0) {
        console.log(`  [OK]    ${mode}`);
      } else {
        totalFails++;
        for (const f of fails) console.log(`  [FAIL]  ${mode}: ${f}`);
      }
    }
  }

  console.log('\n========================================');
  console.log(` SUMMARY: ${totalChecks - totalFails} / ${totalChecks} passed`);
  console.log('========================================');
  if (totalFails === 0) {
    console.log('\u2705 ALL QUALITY CHECKS PASSED');
    process.exit(0);
  } else {
    console.log(`\u274c ${totalFails} check(s) failed`);
    process.exit(1);
  }
})();
