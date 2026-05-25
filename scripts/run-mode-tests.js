/**
 * End-to-end regression test for transcription modes × languages.
 *
 * Directly drives `postProcess` from `dist/main/engines/llm.js` — no
 * Electron runtime needed, just Node + a reachable Groq API key.
 *
 * For each (mode × language) pair we:
 *   1. Feed a pre-written raw-style voice note that mimics what Whisper
 *      actually returns (unpunctuated, mixed colloquialisms, numbers).
 *   2. Call postProcess with the matching {{LANG}} hint.
 *   3. Print the full prompt + response to the console — live feed, so
 *      anomalies surface immediately.
 *   4. Apply per-mode heuristics (length ratio, structural markers,
 *      anti-preamble check) and per-language heuristics (character set,
 *      stop-word presence) to decide PASS / FAIL.
 *
 * Usage:
 *   node scripts/run-mode-tests.js              # single pass
 *   node scripts/run-mode-tests.js --loop 3     # three loops
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const { postProcess } = require(path.join(ROOT, 'dist', 'main', 'engines', 'llm.js'));

// ---- 1. Read the user's settings so we have a real Groq key. -----------
function loadSettings() {
  const p = path.join(process.env.APPDATA || os.homedir(), 'voiceink', 'voiceink-settings.json');
  if (!fs.existsSync(p)) {
    console.error(`✗ settings not found at ${p} — launch VoiceInk once and paste your Groq key in Paramètres.`);
    process.exit(2);
  }
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const s = raw.settings || raw;
  // Allow env override; mirrors what main/services/config.ts does in prod.
  if (!s.groqApiKey && process.env.GROQ_API_KEY) {
    s.groqApiKey = process.env.GROQ_API_KEY;
  }
  if (!s.groqApiKey) {
    console.error('✗ no Groq API key found.');
    console.error('  → Either paste it in VoiceInk → Paramètres → Clé API Groq,');
    console.error('  → or set the GROQ_API_KEY env var before running this harness.');
    process.exit(2);
  }
  // Force the LLM on for the harness: we have a key, and the whole
  // point of the run is to exercise the post-processing prompts.
  return { ...s, llmEnabled: true };
}

// ---- 2. Test fixtures: raw inputs in 5 languages. ----------------------
// They are deliberately "unpunctuated monologue with fillers and numbers"
// so every mode has something to do. Keep them ~60 words.
const INPUTS = {
  fr:
    "alors voilà euh je voulais te dire que demain matin vers neuf heures trente on a la réunion " +
    "avec l'équipe marketing pour finaliser le budget du quatrième trimestre faut qu'on parle " +
    "aussi de la livraison des maquettes qui est prévue pour le 15 novembre et de l'enveloppe " +
    "de vingt-cinq mille euros qui a été approuvée hier ok merci",
  en:
    "so yeah um I wanted to let you know that tomorrow morning around nine thirty we've got the " +
    "meeting with the marketing team to finalise the fourth quarter budget we also gotta talk " +
    "about the mockups delivery scheduled for november fifteenth and the twenty five thousand " +
    "euro envelope that got approved yesterday alright thanks",
  es:
    "entonces bueno eh quería decirte que mañana por la mañana hacia las nueve y media tenemos " +
    "la reunión con el equipo de marketing para cerrar el presupuesto del cuarto trimestre " +
    "también hay que hablar de la entrega de las maquetas prevista para el quince de noviembre " +
    "y del sobre de veinticinco mil euros que se aprobó ayer vale gracias",
  de:
    "also äh ich wollte dir sagen dass wir morgen früh gegen halb zehn das meeting mit dem " +
    "marketing team haben um das budget für das vierte quartal zu finalisieren wir müssen auch " +
    "über die lieferung der entwürfe sprechen die für den fünfzehnten november geplant ist und " +
    "über die fünfundzwanzigtausend euro die gestern genehmigt wurden ok danke",
  ja:
    "えーと 明日の朝九時半頃にマーケティングチームとの打ち合わせがあるので 第四四半期の予算を" +
    "確定させるためです それとあと 十一月十五日に予定されているモックアップの納品の件と " +
    "昨日承認された二万五千ユーロの予算の件についても話す必要があります よろしくお願いします",
};

// ---- 3. Language detectors (heuristic). --------------------------------
const STOPWORDS = {
  fr: /\b(le|la|les|un|une|des|est|et|de|du|que|qui|pour|avec|dans|nous|vous|ils|elles|avons|sont)\b/i,
  en: /\b(the|and|of|to|is|in|that|we|have|with|for|this|are|will|can)\b/i,
  es: /\b(el|la|los|las|y|es|de|que|un|una|para|con|sobre|se|nos|hay|también)\b/i,
  de: /\b(der|die|das|und|ist|ein|eine|für|mit|über|auf|wir|sind|werden|haben)\b/i,
};
function detectLang(text) {
  const t = text.toLowerCase();
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'ja'; // hiragana/katakana
  if (/[\u4e00-\u9fff]/.test(text) && !/[\u3040-\u30ff]/.test(text)) return 'zh';
  if (/[\u0600-\u06ff]/.test(text)) return 'ar';
  if (/[\u0400-\u04ff]/.test(text)) return 'ru';
  // Count matches across Latin stop-word tables.
  const scores = {};
  for (const [code, re] of Object.entries(STOPWORDS)) {
    const m = t.match(new RegExp(re.source, 'gi'));
    scores[code] = m ? m.length : 0;
  }
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (sorted[0][1] === 0) return 'unknown';
  // German-specific chars bias towards de.
  if (/[äöüß]/i.test(text) && scores.de >= scores.fr) return 'de';
  // Spanish-specific.
  if (/[ñ]/i.test(text) && scores.es >= scores.fr) return 'es';
  return sorted[0][0];
}

// ---- 4. Per-mode heuristics. -------------------------------------------
// Each returns { ok: boolean, reason?: string }.
// Per-language spoken-filler lists used by the `formal` heuristic. We
// intentionally keep them tight: only words that are NEVER legitimate
// in formal prose in that specific language.
const FILLERS_BY_LANG = {
  fr: /\b(euh|bah|ouais|mouais|tkt|wesh)\b/i,
  en: /\b(um|uh|yeah|gonna|gotta)\b/i,
  // In German "um" is a preposition ("um … zu"). Real fillers are "äh", "ähm".
  de: /\b(äh|ähm|halt mal)\b/i,
  es: /\b(eh|este|pues bueno eh)\b/i,
  ja: /(えーと|あのー|えっと)/,
};

function checkMode(mode, input, output, lang) {
  if (!output || !output.trim()) return { ok: false, reason: 'empty output' };
  const inLen = input.length;
  const outLen = output.length;

  // No preamble patterns the model might sneak in despite the prompt.
  const preambleRe =
    /^(here (is|are|'s)|voici|bien s[ûu]r|sure|of course|ok here|d'accord|certainly)[^.]*[:.]/i;
  if (preambleRe.test(output.trim())) {
    return { ok: false, reason: 'output starts with a preamble' };
  }

  switch (mode) {
    case 'raw':
      return { ok: output === input, reason: output === input ? '' : 'raw mode should not mutate' };
    case 'summary': {
      const ratio = outLen / inLen;
      if (ratio > 0.85) return { ok: false, reason: `summary too long (${(ratio * 100) | 0}% of input)` };
      if (ratio < 0.1) return { ok: false, reason: `summary too short (${(ratio * 100) | 0}% of input)` };
      return { ok: true };
    }
    case 'email': {
      // Accept a greeting OR a closing — some languages/models will use
      // only one depending on brevity. Hi/Hello/Dear/Bonjour/Salut/etc.
      const greet = /(bonjour|salut|cher|chère|hello|hi|dear|hola|estimad[ao]|hallo|liebe[rn]?|こんにちは|拝啓)/i;
      const close = /(cordialement|bien à vous|salutations|regards|sincerely|best|thanks|un saludo|atentamente|mit freundlichen|よろしく|敬具)/i;
      if (!greet.test(output) && !close.test(output)) {
        return { ok: false, reason: 'email lacks greeting AND closing' };
      }
      return { ok: true };
    }
    case 'meeting': {
      // Notes should be structured — bullets, numbered list, or hard
      // line breaks creating visible blocks.
      const bullets = /^\s*[-*•●]\s+/m.test(output) || /^\s*\d+[.)]\s+/m.test(output);
      if (!bullets && output.split('\n').length < 2) {
        return { ok: false, reason: 'meeting notes have no bullets and no line breaks' };
      }
      return { ok: true };
    }
    case 'formal': {
      // Only check fillers that are never legitimate in the target
      // language. See FILLERS_BY_LANG for details.
      const fillers = FILLERS_BY_LANG[lang];
      if (fillers && fillers.test(output)) {
        return { ok: false, reason: `formal mode kept colloquial filler (${lang})` };
      }
      return { ok: true };
    }
    case 'simple':
      if (outLen > inLen * 1.5) return { ok: false, reason: 'simple mode produced a much longer text' };
      return { ok: true };
    case 'message':
      if (outLen > inLen * 0.8) return { ok: false, reason: 'message mode output too long (>80%)' };
      return { ok: true };
    default:
      return { ok: true };
  }
}

// ---- 5. Main harness. --------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MODES = ['email', 'message', 'meeting', 'summary', 'formal', 'simple'];
// Full matrix would be 6 modes × 5 langs × N loops → too slow at ~1-2s
// per Groq call. Default: every mode × every language, one loop.
const LANGS = ['fr', 'en', 'es', 'de', 'ja'];

async function runMatrix(settings, runIdx) {
  const results = [];
  for (const lang of LANGS) {
    for (const mode of MODES) {
      const input = INPUTS[lang];
      const t0 = Date.now();
      console.log(`\n── [run ${runIdx}] ${lang} / ${mode} ─────────────`);
      console.log('  input :', input.slice(0, 70) + (input.length > 70 ? '…' : ''));
      let output = '';
      let err = null;
      try {
        output = await postProcess(input, mode, settings, lang);
      } catch (e) {
        err = e;
      }
      const ms = Date.now() - t0;
      if (err) {
        console.log('  ERROR :', err?.message || err);
        results.push({ lang, mode, ok: false, reason: 'exception: ' + (err?.message || err), ms });
        continue;
      }
      const oneLine = output.replace(/\s+/g, ' ').trim();
      console.log('  output:', oneLine.slice(0, 120) + (oneLine.length > 120 ? '…' : ''));
      console.log(`  bytes : in=${input.length} out=${output.length} (${ms}ms)`);
      // Stay under Groq free-tier 30 RPM. 2500 ms pacing ≈ 24 RPM; the
      // retry/backoff in llm.ts handles the occasional spike anyway.
      await sleep(2500);

      // 1) Language consistency — detected language of output vs. input language.
      const detected = detectLang(output);
      const langOk = detected === lang || detected === 'unknown';
      // 2) Mode consistency (language-aware for formal's filler list).
      const modeCheck = checkMode(mode, input, output, lang);

      const ok = langOk && modeCheck.ok;
      const reasons = [];
      if (!langOk) reasons.push(`language drifted → ${detected}`);
      if (!modeCheck.ok) reasons.push(modeCheck.reason);

      console.log(`  verdict: ${ok ? 'OK' : 'FAIL'}  ${reasons.join(' | ')}`);
      results.push({ lang, mode, ok, reason: reasons.join(' | '), ms });
    }
  }
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const loopIdx = args.indexOf('--loop');
  const loops = loopIdx >= 0 ? parseInt(args[loopIdx + 1], 10) : 1;

  const settings = loadSettings();
  console.log(`▶ using provider=${settings.llmProvider || 'groq'} model=${settings.llmModel || '(default)'} ` +
    `key=${(settings.groqApiKey || settings.llmApiKey || '').slice(0, 10)}…`);

  let allResults = [];
  for (let r = 1; r <= loops; r++) {
    console.log(`\n╔════════════════════════════╗`);
    console.log(`║   MODE × LANG RUN ${r}/${loops}       ║`);
    console.log(`╚════════════════════════════╝`);
    const results = await runMatrix(settings, r);
    allResults = allResults.concat(results);
  }

  // ---- Summary --------------------------------------------------------
  const total = allResults.length;
  const passed = allResults.filter((r) => r.ok).length;
  const failed = allResults.filter((r) => !r.ok);
  console.log(`\n╔════════════════════════════╗`);
  console.log(`║   SUMMARY: ${passed}/${total} passed    ║`);
  console.log(`╚════════════════════════════╝`);
  if (failed.length) {
    console.log('\nFailures:');
    for (const f of failed) {
      console.log(`  ✗ ${f.lang}/${f.mode}: ${f.reason}`);
    }
    process.exit(1);
  }
  console.log('\n✅ all modes × languages validated');
  process.exit(0);
}

main().catch((e) => {
  console.error('HARNESS ERROR:', e);
  process.exit(3);
});
